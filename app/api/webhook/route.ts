import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendWebhookNotificationEmail } from '@/lib/mailer';
import { buildTelegramCallButton, extractPhoneFromWebhook, formatWebhookToGermanMessage } from '@/lib/message';

/**
 * Public webhook endpoint. Authenticates incoming requests using a Bearer token
 * (the user's secret), looks up the corresponding user in Supabase and sends
 * the formatted German notification through the enabled channels:
 * Telegram, email, or both.
 */
export async function POST(request: Request) {
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

    const messageText = formatWebhookToGermanMessage(payload);
    const phone = extractPhoneFromWebhook(payload);
    const callButton = buildTelegramCallButton(payload);

    const delivery = {
      telegram: 'skipped',
      email: 'skipped',
    };

    if (user.notify_telegram !== false) {
      if (user.telegram_chat_id) {
        try {
          await sendTelegramMessage(user.telegram_chat_id, messageText, callButton);
          delivery.telegram = callButton ? 'sent_with_call_button' : 'sent';
        } catch (error) {
          // Some Telegram clients/API combinations may reject tel: links in inline buttons.
          // If that happens, retry without the button. The phone number remains in the message text.
          if (callButton) {
            try {
              await sendTelegramMessage(user.telegram_chat_id, messageText);
              delivery.telegram = 'sent_without_call_button';
            } catch (retryError) {
              console.error('Telegram delivery failed:', retryError);
              return NextResponse.json(
                {
                  success: false,
                  error: 'Failed to send Telegram message',
                  delivery,
                },
                { status: 500 }
              );
            }
          } else {
            console.error('Telegram delivery failed:', error);
            return NextResponse.json(
              {
                success: false,
                error: 'Failed to send Telegram message',
                delivery,
              },
              { status: 500 }
            );
          }
        }
      } else {
        delivery.telegram = 'missing_chat_id';
      }
    } else {
      delivery.telegram = 'disabled';
    }

    if (user.notify_email !== false) {
      if (user.email) {
        try {
          await sendWebhookNotificationEmail(user.email, messageText, phone);
          delivery.email = 'sent';
        } catch (error) {
          console.error('Email delivery failed:', error);
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to send email notification',
              delivery,
            },
            { status: 500 }
          );
        }
      } else {
        delivery.email = 'missing_email';
      }
    } else {
      delivery.email = 'disabled';
    }

    if (!delivery.telegram.startsWith('sent') && delivery.email !== 'sent') {
      return NextResponse.json({
        success: true,
        message: 'No delivery channel sent',
        delivery,
      });
    }

    return NextResponse.json({ success: true, delivery });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
