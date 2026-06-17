import { format, parseISO, isValid } from 'date-fns';
import { de } from 'date-fns/locale';

/**
 * Transform a webhook JSON payload into a professional German message suitable
 * for Telegram and email. Only include fields that exist; omit undefined values
 * and avoid empty lines.
 */
export function formatWebhookToGermanMessage(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return 'Ungültige Nutzlast.';
  }

  const { timestamp, data } = payload as any;
  const lines: string[] = [];

  const name = cleanText(data?.contact?.name);
  const phone = cleanText(extractPhoneFromWebhook(payload));
  const email = cleanText(data?.contact?.email);
  const company = cleanText(data?.contact?.company);
  const address = cleanText(data?.contact?.address || data?.address);

  const callSummary = cleanText(data?.call?.summary || payload?.message || data?.message);
  const status = cleanText(data?.call?.status);
  const classification = cleanText(data?.call?.classification);
  const sentiment = cleanText(data?.call?.sentiment);
  const recordingUrl = cleanText(data?.call?.recordingUrl);
  const durationMin =
    data?.call?.durationMinutes ?? (data?.call?.duration ? Math.round(data.call.duration / 60) : undefined);

  lines.push('📞 Neuer Anruf');
  lines.push('');

  if (name) {
    lines.push(`${name} hat Sie angerufen.`);
  } else {
    lines.push('Ein Nutzer hat Sie angerufen.');
  }

  lines.push('');

  const contactLines: string[] = [];

  if (name) contactLines.push(`Name: ${name}`);
  if (phone) contactLines.push(`Telefon: ${phone}`);
  if (email) contactLines.push(`E-Mail: ${email}`);
  if (company) contactLines.push(`Firma: ${company}`);
  if (address) contactLines.push(`Adresse: ${address}`);

  if (contactLines.length > 0) {
    lines.push('👤 Kontakt:');
    contactLines.forEach((line) => lines.push(line));
    lines.push('');
  }

  if (callSummary) {
    lines.push('📝 Zusammenfassung:');
    lines.push(callSummary);
    lines.push('');
  }

  const callDetails: string[] = [];

  if (status) callDetails.push(`Status: ${status}`);
  if (typeof durationMin === 'number') callDetails.push(`Dauer: ${durationMin} Minuten`);
  if (classification) callDetails.push(`Klassifizierung: ${classification}`);
  if (sentiment) callDetails.push(`Stimmung: ${sentiment}`);

  if (callDetails.length > 0) {
    lines.push('📊 Anrufdetails:');
    callDetails.forEach((line) => lines.push(line));
    lines.push('');
  }

  if (recordingUrl) {
    lines.push('🔗 Aufnahme:');
    lines.push(recordingUrl);
    lines.push('');
  }

  const formattedDate = formatGermanTimestamp(timestamp);

  if (formattedDate) {
    lines.push('🕒 Zeitpunkt:');
    lines.push(formattedDate);
    lines.push('');
  }

  if (phone) {
    lines.push('📞 Rückruf:');
    lines.push(phone);
    lines.push('');
  }

  lines.push('KI-Rezeption – Ihre digitale Rezeption');

  return lines.join('\n');
}

export function renderWebhookTemplate(payload: any, template: string): string {
  const data = payload?.data || {};
  const call = data?.call || {};
  const contact = data?.contact || {};

  const values: Record<string, string> = {
    event: cleanText(payload?.event),
    contact_name: cleanText(contact?.name) || 'Ein Nutzer',
    contact_phone: cleanText(contact?.phone || data?.phone),
    contact_email: cleanText(contact?.email),
    company: cleanText(contact?.company),
    address: cleanText(contact?.address || data?.address),
    summary: cleanText(call?.summary || data?.message || payload?.message),
    status: cleanText(call?.status),
    duration_minutes: cleanText(call?.durationMinutes ?? (call?.duration ? Math.round(call.duration / 60) : '')),
    classification: cleanText(call?.classification),
    sentiment: cleanText(call?.sentiment),
    recording_url: cleanText(call?.recordingUrl),
    timestamp: formatGermanTimestamp(payload?.timestamp),
  };

  return cleanupRenderedTemplate(
    Object.entries(values).reduce((text, [key, value]) => {
      return text.replaceAll(`{${key}}`, value);
    }, template || '')
  );
}

function cleanupRenderedTemplate(text: string) {
  return text
    .split('\n')
    .filter((line) => !line.match(/^\s*(Name|Telefon|E-Mail|Firma|Adresse|Status|Dauer|Klassifizierung|Stimmung):\s*$/i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPhoneFromWebhook(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload.data || {};

  return (
    data?.contact?.phone ||
    data?.phone ||
    data?.call?.phone ||
    data?.caller?.phone ||
    data?.customer?.phone ||
    ''
  );
}

export function buildTelegramCallButton(payload: any) {
  const rawPhone = cleanText(extractPhoneFromWebhook(payload));
  const phone = normalizePhoneForTelUrl(rawPhone);

  if (!phone) return undefined;

  return {
    inline_keyboard: [
      [
        {
          text: '📞 Jetzt anrufen',
          url: `tel:${phone}`,
        },
      ],
    ],
  };
}

function formatGermanTimestamp(timestamp: any) {
  if (!timestamp) return '';

  try {
    const date = typeof timestamp === 'string' ? parseISO(timestamp) : new Date(timestamp);

    if (!isValid(date)) return '';

    return `${format(date, 'dd.MM.yyyy, HH:mm', { locale: de })} Uhr`;
  } catch {
    return '';
  }
}

function cleanText(value: any) {
  if (value === undefined || value === null) return '';

  return repairMojibake(String(value)).normalize('NFC').trim();
}

/**
 * Repairs common UTF-8 mojibake such as "mÃ¶chte" → "möchte".
 * This protects messages that are sent from tools or systems with wrong encoding.
 */
function repairMojibake(value: string) {
  const replacements: Array<[string, string]> = [
    ['Ã¤', 'ä'],
    ['Ã¶', 'ö'],
    ['Ã¼', 'ü'],
    ['Ã„', 'Ä'],
    ['Ã–', 'Ö'],
    ['Ãœ', 'Ü'],
    ['ÃŸ', 'ß'],
    ['â€“', '–'],
    ['â€”', '—'],
    ['â€ž', '„'],
    ['â€œ', '“'],
    ['â€', '”'],
    ['â€™', '’'],
    ['â€˜', '‘'],
    ['â€¦', '…'],
    ['Â', ''],
  ];

  return replacements.reduce((text, [broken, fixed]) => text.replaceAll(broken, fixed), value);
}

function normalizePhoneForTelUrl(phone: string) {
  if (!phone) return '';

  const normalized = phone.replace(/[^+\d]/g, '');

  if (!normalized) return '';

  return normalized;
}
