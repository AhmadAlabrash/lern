import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';

/**
 * Telegram bot webhook endpoint.
 *
 * When a user starts or messages the bot, this endpoint replies with the
 * Telegram chat_id so the user can send it to the admin.
 *
 * To enable this endpoint, call Telegram setWebhook with:
 * POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
 * body: url=<APP_BASE_URL>/api/telegram/webhook
 * body: secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */
export async function POST(request: Request) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');

    if (expectedSecret && incomingSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const update = await request.json();

    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = message?.text || '';
    const firstName = message?.from?.first_name || '';

    if (!chatId) {
      return NextResponse.json({ success: true, message: 'No chat_id found' });
    }

    const greeting = firstName ? `Hallo ${firstName},` : 'Hallo,';

    if (text.startsWith('/start')) {
      await sendTelegramMessage(
        String(chatId),
        `${greeting}

Ihre Telegram chat_id lautet:

${chatId}

Bitte senden Sie diese chat_id an KI-Rezeption, damit Ihre Webhook-Benachrichtigungen verbunden werden können.

Freundliche Grüße
KI-Rezeption`
      );
    } else {
      await sendTelegramMessage(
        String(chatId),
        `Ihre Telegram chat_id lautet:

${chatId}

Bitte senden Sie diese chat_id an KI-Rezeption, damit Ihre Webhook-Benachrichtigungen verbunden werden können.`
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);

    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}
