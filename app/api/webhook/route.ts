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
import { analyzeCompletedCallWithOpenAI } from '@/lib/call-ai';
import { createWebhookReceipt, markWebhookReceiptProcessed } from '@/lib/webhook-dedupe';
import { extractCallGroupId, getCallNotificationKind, sleep } from '@/lib/call-notification-dedupe';
import { hasHumanEscalationSignal, storeHumanEscalationSignal } from '@/lib/human-escalation-signal';

export const maxDuration = 30;

type DeliveryMap = Record<string, string>;

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
      'template.telegram.human_escalation',
      'template.email.human_escalation',
      'template.sms',
      'translation.provider',
      'translation.translate_ai_summary',
      'translation.translate_transcript',
      'translation.target_lang',
      'openai.api_key',
      'openai.translation_model',
      'openai.analysis_model',
      'ai.human_support_detection_enabled',
      'ai.human_support_confidence_threshold',
      'deepl.api_key',
      'deepl.api_url',
      'dedupe.human_signal_settle_ms',
      'dedupe.call_notification_settle_ms',
      'dedupe.call_completed_hold_ms',
    ]);

    const originalKind = getCallNotificationKind(eventName, payload);
    const callGroupId = extractCallGroupId(payload);
    const delivery: DeliveryMap = {
      event: eventName || 'unknown',
      kind: originalKind,
      call_group_id: callGroupId || '',
      telegram: 'skipped',
      email: 'skipped',
      sms: 'skipped',
    };

    /**
     * IMPORTANT FLOW:
     * human_escalation.requested is a SIGNAL ONLY.
     * It never sends Email/Telegram by itself. That removes the duplicate source.
     * inbound_call.completed is the only event that sends the final call notification.
     */
    if (originalKind === 'human_escalation' && callGroupId) {
      const signal = await storeHumanEscalationSignal({
        userId: String(user.id),
        groupId: callGroupId,
        eventName,
        payload,
      });

      delivery.human_signal = signal.reason;
      delivery.telegram = user.notify_telegram === false ? 'disabled_for_user' : 'signal_only_no_notification';
      delivery.email = user.notify_email === false ? 'disabled_for_user' : 'signal_only_no_notification';
      delivery.sms = user.notify_sms === true ? 'signal_only_no_sms' : 'disabled_for_user';

      if (receipt?.dedupeEnabled) {
        await markWebhookReceiptProcessed(receipt.dedupKey, delivery, signal.stored ? 'human_signal_stored' : 'human_signal_store_failed');
      }

      return NextResponse.json({
        success: true,
        accepted: true,
        status: signal.stored ? 'human_signal_stored' : 'human_signal_store_failed',
        delivery,
      });
    }

    const originalTelegramAllowed =
      user.notify_telegram !== false &&
      shouldDeliverForEvent(settings['routing.telegram_events'], eventName) &&
      Boolean(user.telegram_chat_id);

    const originalEmailAllowed =
      user.notify_email !== false &&
      shouldDeliverForEvent(settings['routing.email_events'], eventName) &&
      Boolean(user.email);

    let shouldSendEmailTelegram = originalTelegramAllowed || originalEmailAllowed;
    const notificationEventName = eventName;
    let notificationKind = originalKind;
    let notificationPayload = payload;

    /**
     * For completed call events, wait briefly for a human_escalation signal.
     * OpenAI analysis starts in parallel with the wait, so the total delay stays low.
     */
    if (shouldSendEmailTelegram && originalKind === 'call_completed' && callGroupId) {
      const analysisPromise = analyzeCompletedCallWithOpenAI(
        notificationPayload,
        settings,
        notificationEventName,
        notificationKind
      );

      const settleMs = getHumanSignalSettleMs(settings);
      await sleep(settleMs);
      delivery.human_signal_wait_ms = String(settleMs);

      const [humanSignal, smartAnalysis] = await Promise.all([
        hasHumanEscalationSignal(String(user.id), callGroupId),
        analysisPromise,
      ]);

      delivery.human_signal = humanSignal.reason;

      if (smartAnalysis.used) {
        notificationPayload = smartAnalysis.payload;
        delivery.ai_human_support = smartAnalysis.needsHumanSupport ? 'yes' : 'no';
        delivery.ai_human_support_confidence = smartAnalysis.confidence !== undefined ? String(smartAnalysis.confidence) : '';
        if (smartAnalysis.reasonDe) delivery.ai_human_support_reason = smartAnalysis.reasonDe;

        if ((settings['translation.translate_transcript'] || 'false') === 'true') {
          notificationPayload = await translateWebhookPayloadToGerman(notificationPayload, {
            ...settings,
            'translation.translate_ai_summary': 'false',
          });
        }
      } else {
        if (smartAnalysis.error) delivery.ai_human_support = `not_used_${smartAnalysis.error}`.slice(0, 180);
        notificationPayload = await translateWebhookPayloadToGerman(notificationPayload, settings);
      }

      if (humanSignal.exists || smartAnalysis.needsHumanSupport) {
        notificationKind = 'human_escalation';
        delivery.notification_kind = humanSignal.exists ? 'human_escalation_signal' : 'human_escalation_openai';
      } else {
        delivery.notification_kind = 'call_completed';
      }
    } else if (shouldSendEmailTelegram) {
      notificationPayload = await translateWebhookPayloadToGerman(notificationPayload, settings);
    }

    const phone = extractPhoneFromWebhook(notificationPayload);
    const callButton = buildTelegramCallButton(notificationPayload);
    const telegramTemplate = selectNotificationTemplate(settings, 'telegram', notificationKind);
    const emailTemplate = selectNotificationTemplate(settings, 'email', notificationKind);
    const telegramMessage = renderWebhookTemplate(notificationPayload, telegramTemplate);
    const emailMessage = renderWebhookTemplate(notificationPayload, emailTemplate);

    if (user.notify_telegram !== false) {
      if (!shouldDeliverForEvent(settings['routing.telegram_events'], notificationEventName)) {
        delivery.telegram = 'event_not_enabled';
      } else if (!user.telegram_chat_id) {
        delivery.telegram = 'missing_chat_id';
      } else if (!shouldSendEmailTelegram) {
        delivery.telegram = 'suppressed';
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
              await logDeliveryError({ channel: 'telegram', eventName: notificationEventName, user, message: getErrorMessage(retryError), details: { delivery } });
            }
          } else {
            delivery.telegram = 'failed';
            console.error('Telegram delivery failed:', error);
            await logDeliveryError({ channel: 'telegram', eventName: notificationEventName, user, message: getErrorMessage(error), details: { delivery } });
          }
        }
      }
    } else {
      delivery.telegram = 'disabled_for_user';
    }

    if (user.notify_email !== false) {
      if (!shouldDeliverForEvent(settings['routing.email_events'], notificationEventName)) {
        delivery.email = 'event_not_enabled';
      } else if (!user.email) {
        delivery.email = 'missing_email';
      } else if (!shouldSendEmailTelegram) {
        delivery.email = 'suppressed';
      } else {
        try {
          await sendWebhookNotificationEmail(user.email, emailMessage, phone);
          delivery.email = 'sent';
        } catch (error) {
          delivery.email = 'failed';
          console.error('Email delivery failed:', error);
          await logDeliveryError({ channel: 'email', eventName: notificationEventName, user, message: getErrorMessage(error), details: { delivery } });
        }
      }
    } else {
      delivery.email = 'disabled_for_user';
    }

    // SMS stays event-based and independent.
    if (user.notify_sms === true) {
      if (!shouldDeliverForEvent(settings['routing.sms_events'], eventName)) {
        delivery.sms = 'event_not_enabled';
      } else {
        const smsPhone = extractPhoneFromWebhook(payload);
        const smsTo = normalizePhoneForSms(smsPhone);

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
                contactName: extractContactNameFromWebhook(payload),
                contactPhone: smsPhone,
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

function getHumanSignalSettleMs(settings: Record<string, string>) {
  const raw = Number(
    settings['dedupe.human_signal_settle_ms'] ||
      settings['dedupe.call_notification_settle_ms'] ||
      settings['dedupe.call_completed_hold_ms'] ||
      '12000'
  );

  if (!Number.isFinite(raw)) return 12000;
  return Math.max(2000, Math.min(20000, Math.round(raw)));
}

function selectNotificationTemplate(settings: Record<string, string>, channel: 'telegram' | 'email', kind: string) {
  if (kind === 'human_escalation') {
    const humanTemplate = settings[`template.${channel}.human_escalation`];
    if (humanTemplate && humanTemplate.trim()) return humanTemplate;
  }

  return settings[`template.${channel}`] || '';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
