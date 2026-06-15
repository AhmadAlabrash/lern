import nodemailer from 'nodemailer';

/**
 * Create a reusable Nodemailer transporter. The SMTP configuration is loaded
 * from environment variables. Do not expose any of these secrets on the client.
 */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secureRaw = process.env.SMTP_SECURE ?? 'false';
  const secure = secureRaw === 'true' || secureRaw === '1';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration is incomplete');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export function getSmtpConfigStatus() {
  return {
    configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || '',
    secure: process.env.SMTP_SECURE || '',
    user: maskValue(process.env.SMTP_USER || ''),
    from: process.env.SMTP_FROM || '',
  };
}

/**
 * Send a German, branded email containing the webhook secret.
 */
export async function sendSecretEmail(to: string, secret: string) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  const subject = 'Ihr Webhook-Zugang für KI-Rezeption';

  const appBaseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const webhookEndpoint = appBaseUrl ? `${appBaseUrl}/api/webhook` : '/api/webhook';

  const safeSecret = escapeHtml(secret);
  const safeEndpoint = escapeHtml(webhookEndpoint);

  const text = `Guten Tag,

Ihr persönlicher Webhook-Zugang für KI-Rezeption wurde eingerichtet.

Ihr geheimer Token:
${secret}

Bitte verwenden Sie diesen Token als Bearer Token, wenn Sie Webhook-Ereignisse an unsere API senden.

Webhook-Endpunkt:
${webhookEndpoint}

Beispiel:
Authorization: Bearer ${secret}

Bitte behandeln Sie diesen Token vertraulich und geben Sie ihn nicht öffentlich weiter.

Freundliche Grüße
KI-Rezeption`;

  const html = createBrandedEmailHtml({
    eyebrow: 'KI-Rezeption',
    title: 'Ihr Webhook-Zugang ist bereit',
    intro:
      'Nutzen Sie den folgenden Token, um Webhook-Ereignisse sicher an Ihre KI-Rezeption zu senden.',
    bodyHtml: `
      <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#334155;">Guten Tag,</p>
      <p style="margin:0 0 24px 0;font-size:16px;line-height:1.7;color:#334155;">
        Ihr persönlicher Webhook-Zugang wurde erfolgreich eingerichtet.
        Bitte verwenden Sie diesen geheimen Token als <strong>Bearer Token</strong> bei allen Webhook-Anfragen.
      </p>
      <div style="margin:0 0 24px 0;padding:20px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Ihr geheimer Token</div>
        <div style="font-family:Consolas,Monaco,monospace;font-size:14px;line-height:1.6;color:#0f172a;background:#ffffff;border:1px solid #dbe4ee;border-radius:14px;padding:14px;word-break:break-all;">
          ${safeSecret}
        </div>
      </div>
      <div style="margin:0 0 24px 0;padding:18px;border-radius:18px;background:#eef2ff;border:1px solid #c7d2fe;">
        <div style="font-size:13px;font-weight:700;color:#3730a3;margin-bottom:8px;">Webhook-Endpunkt</div>
        <div style="font-family:Consolas,Monaco,monospace;font-size:14px;color:#312e81;word-break:break-all;">${safeEndpoint}</div>
      </div>
      <p style="margin:0 0 10px 0;font-size:15px;line-height:1.7;color:#334155;">
        Beispiel für den Authorization Header:
      </p>
      <div style="margin:0 0 24px 0;font-family:Consolas,Monaco,monospace;font-size:14px;line-height:1.6;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:14px;word-break:break-all;">
        Authorization: Bearer ${safeSecret}
      </div>
      <p style="margin:0 0 24px 0;font-size:14px;line-height:1.7;color:#64748b;">
        Bitte behandeln Sie diesen Token vertraulich. Wenn Sie den Verdacht haben, dass der Token öffentlich geworden ist,
        lassen Sie bitte einen neuen Zugang erstellen.
      </p>
      <p style="margin:0;font-size:16px;line-height:1.7;color:#334155;">
        Freundliche Grüße<br />
        <strong>KI-Rezeption</strong>
      </p>
    `,
  });

  return transporter.sendMail({ from, to, subject, text, html });
}

/**
 * Send the same formatted call notification by email when a webhook event arrives.
 */
export async function sendWebhookNotificationEmail(to: string, messageText: string, phone?: string) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  const subject = 'Neue Benachrichtigung von KI-Rezeption';

  const cleanPhone = normalizePhoneForTelUrl(phone || '');

  const text = `${messageText}

${cleanPhone ? `Direkt anrufen: tel:${cleanPhone}\n\n` : ''}---
Diese Nachricht wurde automatisch von KI-Rezeption erstellt.`;

  const safeMessage = escapeHtml(messageText).replaceAll('\n', '<br />');

  const callButtonHtml = cleanPhone
    ? `
      <div style="margin:0 0 24px 0;text-align:center;">
        <a href="tel:${escapeHtml(cleanPhone)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 22px;font-size:15px;">
          📞 Jetzt anrufen
        </a>
      </div>
    `
    : '';

  const html = createBrandedEmailHtml({
    eyebrow: 'KI-Rezeption',
    title: 'Neue Webhook-Benachrichtigung',
    intro: 'Ein neues Ereignis wurde empfangen und für Sie aufbereitet.',
    bodyHtml: `
      <div style="margin:0 0 24px 0;padding:20px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:15px;line-height:1.75;color:#0f172a;">${safeMessage}</div>
      </div>
      ${callButtonHtml}
      <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">
        Diese Nachricht wurde automatisch von KI-Rezeption erstellt.
      </p>
    `,
  });

  return transporter.sendMail({ from, to, subject, text, html });
}

export async function sendSmtpTestEmail(to: string) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  const subject = 'SMTP-Test von KI-Rezeption';

  const text = `Guten Tag,

dies ist eine Testnachricht von KI-Rezeption.

Wenn Sie diese E-Mail erhalten haben, ist Ihre SMTP-Konfiguration korrekt.

Freundliche Grüße
KI-Rezeption`;

  const html = createBrandedEmailHtml({
    eyebrow: 'KI-Rezeption',
    title: 'SMTP-Test erfolgreich',
    intro: 'Wenn Sie diese Nachricht erhalten haben, funktioniert Ihre SMTP-Konfiguration.',
    bodyHtml: `
      <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#334155;">Guten Tag,</p>
      <p style="margin:0 0 24px 0;font-size:16px;line-height:1.7;color:#334155;">
        dies ist eine Testnachricht von <strong>KI-Rezeption</strong>.
        Ihre SMTP-Konfiguration funktioniert.
      </p>
      <p style="margin:0;font-size:16px;line-height:1.7;color:#334155;">
        Freundliche Grüße<br />
        <strong>KI-Rezeption</strong>
      </p>
    `,
  });

  return transporter.sendMail({ from, to, subject, text, html });
}

function createBrandedEmailHtml({
  eyebrow,
  title,
  intro,
  bodyHtml,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  bodyHtml: string;
}) {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
            <tr>
              <td style="background:#0f172a;padding:32px 32px 28px 32px;color:#ffffff;">
                <div style="font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#a5b4fc;font-weight:700;">${escapeHtml(eyebrow)}</div>
                <h1 style="margin:10px 0 0 0;font-size:28px;line-height:1.25;font-weight:800;">${escapeHtml(title)}</h1>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:#cbd5e1;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                  KI-Rezeption · Automatische Benachrichtigung
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function normalizePhoneForTelUrl(phone: string) {
  if (!phone) return '';

  return phone.replace(/[^+\d]/g, '');
}

function maskValue(value: string) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
