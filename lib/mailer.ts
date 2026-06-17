import nodemailer from 'nodemailer';
import { getSettingsMap } from './settings';

/**
 * Create a reusable Nodemailer transporter. It prefers admin dashboard settings
 * stored in Supabase and falls back to environment variables.
 */
async function getSmtpConfig() {
  const settings = await getSettingsMap([
    'smtp.host',
    'smtp.port',
    'smtp.secure',
    'smtp.user',
    'smtp.pass',
    'smtp.from',
  ]);

  const host = settings['smtp.host'] || process.env.SMTP_HOST || '';
  const port = parseInt(settings['smtp.port'] || process.env.SMTP_PORT || '587', 10);
  const secureRaw = settings['smtp.secure'] || process.env.SMTP_SECURE || 'false';
  const secure = secureRaw === 'true' || secureRaw === '1';
  const user = settings['smtp.user'] || process.env.SMTP_USER || '';
  const pass = settings['smtp.pass'] || process.env.SMTP_PASS || '';
  const from = settings['smtp.from'] || process.env.SMTP_FROM || user;

  return { host, port, secure, user, pass, from };
}

async function createTransporter() {
  const config = await getSmtpConfig();

  if (!config.host || !config.user || !config.pass) {
    throw new Error('SMTP configuration is incomplete');
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
}

export async function getSmtpConfigStatus() {
  const config = await getSmtpConfig();

  return {
    configured: Boolean(config.host && config.user && config.pass),
    host: config.host,
    port: String(config.port),
    secure: String(config.secure),
    user: maskValue(config.user),
    from: config.from,
  };
}

/**
 * Send a German, branded email containing the webhook secret.
 */
export async function sendSecretEmail(to: string, secret: string) {
  const transporter = await createTransporter();
  const { from } = await getSmtpConfig();
  const appBaseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const webhookEndpoint = appBaseUrl ? `${appBaseUrl}/api/webhook` : '/api/webhook';

  const settings = await getSettingsMap(['template.secret_email_subject', 'template.secret_email_text']);
  const subject = renderSimpleTemplate(
    settings['template.secret_email_subject'] || 'Ihr Webhook-Zugang für KI-Rezeption',
    {
      secret,
      email: to,
      app_base_url: appBaseUrl,
      webhook_endpoint: webhookEndpoint,
    }
  );

  const text = renderSimpleTemplate(settings['template.secret_email_text'], {
    secret,
    email: to,
    app_base_url: appBaseUrl,
    webhook_endpoint: webhookEndpoint,
  });

  const safeText = escapeHtml(text).replaceAll('\n', '<br />');

  const html = createBrandedEmailHtml({
    eyebrow: 'KI-Rezeption',
    title: 'Ihr Webhook-Zugang ist bereit',
    intro: 'Diese Nachricht enthält den persönlichen Webhook-Token.',
    bodyHtml: `
      <div style="margin:0 0 24px 0;padding:22px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:15px;line-height:1.8;color:#0f172a;word-break:break-word;">${safeText}</div>
      </div>
      <div style="margin:0 0 24px 0;padding:18px;border-radius:18px;background:#eef2ff;border:1px solid #c7d2fe;">
        <div style="font-size:13px;font-weight:700;color:#3730a3;margin-bottom:8px;">Webhook-Endpunkt</div>
        <div style="font-family:Consolas,Monaco,monospace;font-size:14px;color:#312e81;word-break:break-all;">${escapeHtml(webhookEndpoint)}</div>
      </div>
    `,
  });

  return transporter.sendMail({ from, to, subject, text, html });
}

/**
 * Send the same formatted call notification by email when a webhook event arrives.
 */
export async function sendWebhookNotificationEmail(to: string, messageText: string, phone?: string) {
  const transporter = await createTransporter();
  const { from } = await getSmtpConfig();
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
  const transporter = await createTransporter();
  const { from } = await getSmtpConfig();
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


export async function sendOperationalAlertEmail(to: string, messageText: string) {
  const transporter = await createTransporter();
  const { from } = await getSmtpConfig();
  const subject = 'KI-Rezeption Fehleralarm';
  const safeMessage = escapeHtml(messageText).replaceAll('\n', '<br />');

  const html = createBrandedEmailHtml({
    eyebrow: 'KI-Rezeption Monitor',
    title: 'Fehleralarm',
    intro: 'Ein Zustellfehler wurde erkannt.',
    bodyHtml: `
      <div style="margin:0 0 24px 0;padding:20px;border-radius:18px;background:#fff1f2;border:1px solid #fecdd3;">
        <div style="font-size:15px;line-height:1.75;color:#881337;">${safeMessage}</div>
      </div>
    `,
  });

  return transporter.sendMail({ from, to, subject, text: messageText, html });
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

function renderSimpleTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{${key}}`, value || '');
  }, template || '');
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
