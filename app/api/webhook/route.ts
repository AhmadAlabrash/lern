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
import { claimCallCompletedGuard, claimHumanEscalationGuard, isCallBlockedByHumanOrSent, prepareCallCompletedGuard } from '@/lib/call-notification-guard';

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
      'dedupe.call_notification_settle_ms',
      'dedupe.call_completed_hold_ms',
    ]);

    const originalKind = getCallNotificationKind(eventName, payload);
    const delivery: DeliveryMap = {
      event: eventName || 'unknown',
      kind: originalKind,
      telegram: 'skipped',
      email: 'skipped',
      sms: 'skipped',
    };

    const originalTelegramAllowed =
      user.notify_telegram !== false &&
      shouldDeliverForEvent(settings['routing.telegram_events'], eventName) &&
      Boolean(user.telegram_chat_id);

    const originalEmailAllowed =
      user.notify_email !== false &&
      shouldDeliverForEvent(settings['routing.email_events'], eventName) &&
      Boolean(user.email);

    const callGroupId = extractCallGroupId(payload);
    const shouldUseCallGuard =
      Boolean(callGroupId) &&
      (originalKind === 'call_completed' || originalKind === 'human_escalation') &&
      (originalTelegramAllowed || originalEmailAllowed);

    let shouldSendEmailTelegram = originalTelegramAllowed || originalEmailAllowed;
    let notificationEventName = eventName;
    let notificationKind = originalKind;
    let notificationPayload = payload;
    let needsFinalCallGuardClaim = false;

    if (shouldUseCallGuard && callGroupId) {
      if (originalKind === 'human_escalation') {
        const guard = await claimHumanEscalationGuard({
          userId: String(user.id),
          groupId: callGroupId,
          eventName,
          kind: originalKind,
          payload,
        });

        delivery.call_guard = guard.reason;
        shouldSendEmailTelegram = guard.shouldSend;
      }

      if (originalKind === 'call_completed') {
        const prepared = await prepareCallCompletedGuard({
          userId: String(user.id),
          groupId: callGroupId,
          eventName,
          kind: originalKind,
          payload,
        });

        delivery.call_guard = prepared.reason;

        if (!prepared.shouldSend) {
          shouldSendEmailTelegram = false;
        } else {
          const settleMs = getCallNotificationSettleMs(settings);
          await sleep(settleMs);
          delivery.call_guard_wait_ms = String(settleMs);

          const afterWait = await isCallBlockedByHumanOrSent(String(user.id), callGroupId);
          delivery.call_guard_after_wait = afterWait.reason;

          if (!afterWait.shouldSend) {
            shouldSendEmailTelegram = false;
          } else {
            shouldSendEmailTelegram = true;
            needsFinalCallGuardClaim = true;
          }
        }
      }
    }

    if (shouldSendEmailTelegram) {
      const smartAnalysis = await analyzeCompletedCallWithOpenAI(
        notificationPayload,
        settings,
        notificationEventName,
        notificationKind
      );

      if (smartAnalysis.used) {
        notificationPayload = smartAnalysis.payload;
        delivery.ai_human_support = smartAnalysis.needsHumanSupport ? 'yes' : 'no';
        delivery.ai_human_support_confidence = smartAnalysis.confidence !== undefined ? String(smartAnalysis.confidence) : '';
        if (smartAnalysis.reasonDe) delivery.ai_human_support_reason = smartAnalysis.reasonDe;

        // If no dedicated human_escalation event arrived during the wait window,
        // OpenAI may still choose the Human template for this one final notification.
        if (smartAnalysis.needsHumanSupport && notificationKind === 'call_completed') {
          notificationKind = 'human_escalation';
          delivery.notification_kind = notificationKind;
        }

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
    }

    if (needsFinalCallGuardClaim && callGroupId && shouldSendEmailTelegram) {
      const finalGuard = await claimCallCompletedGuard(
        {
          userId: String(user.id),
          groupId: callGroupId,
          eventName: notificationEventName,
          kind: originalKind,
          payload: notificationPayload,
        },
        notificationKind
      );

      delivery.call_guard_final = finalGuard.reason;
      if (!finalGuard.shouldSend) {
        shouldSendEmailTelegram = false;
      }
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
        delivery.telegram = 'suppressed_same_call';
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
        delivery.email = 'suppressed_same_call';
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

    // SMS stays event-based and independent from the one-call Email/Telegram queue.
    // This keeps appointment.requested SMS working even when call notifications are
    // suppressed or merged.
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

function getCallNotificationSettleMs(settings: Record<string, string>) {
  const raw = Number(settings['dedupe.call_notification_settle_ms'] || settings['dedupe.call_completed_hold_ms'] || '10000');
  if (!Number.isFinite(raw)) return 10000;
  return Math.max(3000, Math.min(14000, Math.round(raw)));
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
