import { getSettingsMap } from './settings';

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
};

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: TelegramReplyMarkup
) {
  const settings = await getSettingsMap(['telegram.bot_token']);
  const token = settings['telegram.bot_token'] || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error('Telegram bot token is not configured');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, any> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('Failed to send Telegram message', errorText);
    throw new Error(errorText || 'Failed to send Telegram message');
  }

  return res.json();
}
