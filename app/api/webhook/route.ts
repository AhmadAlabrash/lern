import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendWebhookNotificationEmail } from '@/lib/mailer';
import { buildTelegramCallButton, extractContactNameFromWebhook, extractPhoneFromWebhook, renderWebhookTemplate } from '@/lib/message';
import { buildCallerSmsMessage, normalizePhoneForSms, sendSms } from '@/lib/sms';
import { getSettingsMap } from '@/lib/settings';
import { getEventName, shouldDeliverForEvent } from '@/lib/events';
import { getCurrentSmsUsageMonth, getMonthlySmsUsage, getPlanSmsLimit, incrementMonthlySmsUsage } from '@/lib/plans';
import { logDeliveryError } from '@/lib/monitoring';
import { translateWebhookPayloadToGerman } from '@/lib/translate';
import { createWebhookReceipt, markWebhookReceiptProcessed } from '@/lib/webhook-dedupe';

/**
 * Public webhook endpoint.
 *
 * Important behavior:
 * - Auth / invalid JSON still return errors.
 * - After a valid event is accepted, delivery-channel failures are logged but
 *   the endpoint still returns 200. This prevents the upstream webhook sender
 *   from retrying and creating duplicate emails/Telegram/SMS notifications.
 * - Idempotency is handled by webhook_event_receipts, so the same callId /
 *   conversationId / callSid is only notified once even if the sender retries.
 */
export async function POST(request: Request) {
  let receipt: Awaited<ReturnType<typeof createWebhookReceipt>> | null = null;
  let eventName = 'unknown';

  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing bearer token' }, { status: 401 });
    }

    const token = authHeader.slice('Bearer '.length).trim();

    if (!token) {
      return NextResponse.json({ success: false, error: 'Invalid bearer token' }, { status: 401 });
    }

    let payload: any;

    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const supabase = createServiceSupabaseClient();

    const { data: user, error } = await supabase
      .from('webhook_users')
      .select('*')
      .eq('secret', token)
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid bearer token' }, { status: 401 });
    }

    eventName = getEventName(payload);

    receipt = await createWebhookReceipt({
      userId: String(user.id),
      eventName,
      payload,
    });

    if (receipt.dedupeEnabled && !receipt.firstDelivery) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Duplicate webhook retry ignored',
        event: eventName,
      });
    }

    const settings = await getSettingsMap([
      'routing.telegram_events',
      'routing.email_events',
      'routing.sms_events',
      'template.telegram',
      'template.email',
      'template.sms',
      'translation.provider',
      'translation.translate_ai_summary',
      'translation.translate_transcript',
      'translation.target_lang',
      'openai.api_key',
      'openai.translation_model',
      'deepl.api_key',
      'deepl.api_url',
    ]);

    const notificationPayload = await translateWebhookPayloadToGerman(payload, settings);
    const phone = extractPhoneFromWebhook(notificationPayload);
    const callButton = buildTelegramCallButton(notificationPayload);

    const telegramMessage = renderWebhookTemplate(notificationPayload, settings['template.telegram']);
    const emailMessage = renderWebhookTemplate(notificationPayload, settings['template.email']);

    const delivery: Record<string, string> = {
      event: eventName || 'unknown',
      telegram: 'skipped',
      email: 'skipped',
      sms: 'skipped',
    };

    if (user.notify_telegram !== false) {
      if (!shouldDeliverForEvent(settings['routing.telegram_events'], eventName)) {
        delivery.telegram = 'event_not_enabled';
      } else if (!user.telegram_chat_id) {
        delivery.telegram = 'missing_chat_id';
      } else {
        try {
          await sendTelegramMessage(user.telegram_chat_id, telegramMessage, callButton);
          delivery.telegram = callButton ? 'sent_with_call_button' : 'sent';
        } catch (error) {
          if (callButton) {
            try {
              await sendTelegramMessage(user.telegram_chat_id, telegramMessage);
              delivery.telegram = 'sent_without_call_button';
            } catch (retryError) {
              delivery.telegram = 'failed';
              console.error('Telegram delivery failed:', retryError);
              await logDeliveryError({ channel: 'telegram', eventName, user, message: getErrorMessage(retryError), details: { delivery } });
            }
          } else {
            delivery.telegram = 'failed';
            console.error('Telegram delivery failed:', error);
            await logDeliveryError({ channel: 'telegram', eventName, user, message: getErrorMessage(error), details: { delivery } });
          }
        }
      }
    } else {
      delivery.telegram = 'disabled_for_user';
    }

    if (user.notify_email !== false) {
      if (!shouldDeliverForEvent(settings['routing.email_events'], eventName)) {
        delivery.email = 'event_not_enabled';
      } else if (!user.email) {
        delivery.email = 'missing_email';
      } else {
        try {
          await sendWebhookNotificationEmail(user.email, emailMessage, phone);
          delivery.email = 'sent';
        } catch (error) {
          delivery.email = 'failed';
          console.error('Email delivery failed:', error);
          await logDeliveryError({ channel: 'email', eventName, user, message: getErrorMessage(error), details: { delivery } });
        }
      }
    } else {
      delivery.email = 'disabled_for_user';
    }

    if (user.notify_sms === true) {
      if (!shouldDeliverForEvent(settings['routing.sms_events'], eventName)) {
        delivery.sms = 'event_not_enabled';
      } else {
        const smsTo = normalizePhoneForSms(phone);

        if (!smsTo) {
          delivery.sms = 'missing_phone';
        } else if (user.sms_provider === 'future_provider') {
          delivery.sms = 'provider_not_implemented';
        } else {
          const month = getCurrentSmsUsageMonth();
          const planLimit = await getPlanSmsLimit(user.plan);
          const currentUsage = await getMonthlySmsUsage(user.id, month);

          if (currentUsage >= planLimit) {
            delivery.sms = `monthly_limit_reached_${currentUsage}/${planLimit}`;
          } else {
            try {
              const smsBody = buildCallerSmsMessage({
                template: settings['template.sms'],
                bookingUrl: user.booking_url,
                whatsappNumber: user.whatsapp_number,
                contactName: extractContactNameFromWebhook(notificationPayload),
                contactPhone: phone,
                eventName,
              });

              await sendSms({
                to: smsTo,
                body: smsBody,
                provider: user.sms_provider || 'twilio',
              });

              const newUsage = await incrementMonthlySmsUsage(user.id, month);
              delivery.sms = `sent_${newUsage}/${planLimit}`;
            } catch (error) {
              delivery.sms = 'failed';
              console.error('SMS delivery failed:', error);
              await logDeliveryError({ channel: 'sms', eventName, user, message: getErrorMessage(error), details: { delivery } });
            }
          }
        }
      }
    } else {
      delivery.sms = 'disabled_for_user';
    }

    const anySent = delivery.telegram.startsWith('sent') || delivery.email === 'sent' || delivery.sms.startsWith('sent');
    const anyFailed = delivery.telegram === 'failed' || delivery.email === 'failed' || delivery.sms === 'failed';
    const status = anySent ? (anyFailed ? 'processed_with_channel_errors' : 'processed') : anyFailed ? 'accepted_with_channel_errors' : 'no_channel_sent';

    if (receipt?.dedupeEnabled) {
      await markWebhookReceiptProcessed(receipt.dedupKey, delivery, status);
    }

    return NextResponse.json({
      success: true,
      accepted: true,
      status,
      delivery,
    });
  } catch (error) {
    console.error(error);

    if (receipt?.dedupeEnabled) {
      await markWebhookReceiptProcessed(receipt.dedupKey, { error: getErrorMessage(error) }, 'failed_before_response');
    }

    return NextResponse.json({ success: false, error: 'Server error', event: eventName }, { status: 500 });
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
