import { getSettingsMap } from './settings';

export type SmsProvider = 'twilio' | 'future_provider';

export const DEFAULT_SMS_TEMPLATE =
  'Danke für deinen Anruf. Deinen Termin kannst du hier buchen: {booking_url} Für weitere Hilfe erreichst du uns auf WhatsApp: {whatsapp_link}';

type SmsResult = {
  provider: SmsProvider;
  sid?: string;
  status?: string;
};

export function buildCallerSmsMessage({
  template,
  bookingUrl,
  whatsappNumber,
  contactName,
  contactPhone,
  eventName,
}: {
  template?: string | null;
  bookingUrl?: string | null;
  whatsappNumber?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  eventName?: string | null;
}) {
  const whatsappLink = whatsappNumber ? buildWhatsappLink(whatsappNumber, 'Hallo') : '';

  return renderTemplate(template || DEFAULT_SMS_TEMPLATE, {
    booking_url: bookingUrl || '',
    whatsapp_number: whatsappNumber || '',
    whatsapp_link: whatsappLink,
    contact_name: contactName || '',
    contact_phone: contactPhone || '',
    event: eventName || '',
  });
}

export async function sendSms({
  to,
  body,
  provider,
}: {
  to: string;
  body: string;
  provider?: string | null;
}): Promise<SmsResult> {
  const settings = await getSettingsMap(['sms.default_provider']);
  const selectedProvider = normalizeProvider(
    provider || settings['sms.default_provider'] || process.env.SMS_DEFAULT_PROVIDER || 'twilio'
  );

  if (selectedProvider === 'twilio') {
    return sendTwilioSms({ to, body });
  }

  throw new Error(`SMS provider "${selectedProvider}" is not implemented yet`);
}

export async function getSmsConfigStatus() {
  const settings = await getSettingsMap([
    'sms.default_provider',
    'twilio.account_sid',
    'twilio.auth_token',
    'twilio.messaging_service_sid',
  ]);

  const accountSid = settings['twilio.account_sid'] || process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = settings['twilio.auth_token'] || process.env.TWILIO_AUTH_TOKEN || '';
  const messagingServiceSid =
    settings['twilio.messaging_service_sid'] || process.env.TWILIO_MESSAGING_SERVICE_SID || '';

  return {
    defaultProvider: settings['sms.default_provider'] || process.env.SMS_DEFAULT_PROVIDER || 'twilio',
    twilio: {
      configured: Boolean(accountSid && authToken && messagingServiceSid),
      accountSid: maskValue(accountSid),
      messagingServiceSid: maskValue(messagingServiceSid),
    },
  };
}

export function normalizePhoneForSms(phone: string) {
  if (!phone) return '';

  return phone.replace(/[^+\d]/g, '');
}

function renderTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{${key}}`, value);
  }, template);
}

function normalizeProvider(provider: string): SmsProvider {
  if (provider === 'future_provider') return 'future_provider';

  return 'twilio';
}

function buildWhatsappLink(whatsappNumber: string, message: string) {
  const normalized = whatsappNumber.replace(/[^\d]/g, '');

  if (!normalized) return '';

  return `https://api.whatsapp.com/send?phone=${normalized}&text=${encodeURIComponent(message)}`;
}

async function sendTwilioSms({ to, body }: { to: string; body: string }): Promise<SmsResult> {
  const settings = await getSettingsMap([
    'twilio.account_sid',
    'twilio.auth_token',
    'twilio.messaging_service_sid',
  ]);

  const accountSid = settings['twilio.account_sid'] || process.env.TWILIO_ACCOUNT_SID;
  const authToken = settings['twilio.auth_token'] || process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid =
    settings['twilio.messaging_service_sid'] || process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error('Twilio SMS configuration is incomplete');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.set('To', to);
  params.set('MessagingServiceSid', messagingServiceSid);
  params.set('Body', body);

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: params.toString(),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Twilio SMS error:', json);
    throw new Error(json?.message || 'Failed to send SMS via Twilio');
  }

  return {
    provider: 'twilio',
    sid: json?.sid,
    status: json?.status,
  };
}

function maskValue(value: string) {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
