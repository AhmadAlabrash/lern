import { isValid, parseISO } from 'date-fns';

/**
 * Transform a webhook JSON payload into a professional German message suitable
 * for Telegram and email. The normalizer supports both the old test payload
 * shape and the real call payload shape from the voice system / ElevenLabs.
 */
export function formatWebhookToGermanMessage(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return 'Ungültige Nutzlast.';
  }

  const values = buildWebhookTemplateValues(payload);
  const lines: string[] = [];

  lines.push('📞 Neuer Anruf eingegangen');
  lines.push('');

  if (values.contact_name && values.contact_name !== 'Ein Nutzer') {
    lines.push(`${values.contact_name} hat Sie angerufen.`);
  } else if (values.contact_phone) {
    lines.push(`Anruf von ${values.contact_phone}.`);
  } else {
    lines.push('Ein neuer Anruf wurde empfangen.');
  }

  lines.push('');

  const contactLines: string[] = [];
  if (values.contact_name && values.contact_name !== 'Ein Nutzer') contactLines.push(`Name: ${values.contact_name}`);
  if (values.contact_phone) contactLines.push(`Telefon: ${values.contact_phone}`);
  if (values.contact_email) contactLines.push(`E-Mail: ${values.contact_email}`);
  if (values.company) contactLines.push(`Firma: ${values.company}`);
  if (values.address) contactLines.push(`Adresse: ${values.address}`);

  if (contactLines.length > 0) {
    lines.push('👤 Kontakt:');
    contactLines.forEach((line) => lines.push(line));
    lines.push('');
  }

  const detailLines: string[] = [];
  if (values.event) detailLines.push(`Event: ${values.event}`);
  if (values.direction) detailLines.push(`Richtung: ${translateDirection(values.direction)}`);
  if (values.status) detailLines.push(`Status: ${values.status}`);
  if (values.duration) detailLines.push(`Dauer: ${values.duration}`);
  if (values.to_number) detailLines.push(`Angerufene Nummer: ${values.to_number}`);
  if (values.timestamp) detailLines.push(`Zeitpunkt: ${values.timestamp}`);

  if (detailLines.length > 0) {
    lines.push('📊 Details:');
    detailLines.forEach((line) => lines.push(line));
    lines.push('');
  }

  if (values.summary) {
    lines.push('📝 Zusammenfassung:');
    lines.push(values.summary);
    lines.push('');
  }

  if (values.transcript) {
    lines.push('💬 Transkript:');
    lines.push(values.transcript);
    lines.push('');
  }

  if (values.recording_url) {
    lines.push('🔗 Aufnahme:');
    lines.push(values.recording_url);
    lines.push('');
  }

  if (values.call_id || values.conversation_id) {
    lines.push('🧾 IDs:');
    if (values.call_id) lines.push(`Call ID: ${values.call_id}`);
    if (values.conversation_id) lines.push(`Conversation ID: ${values.conversation_id}`);
    lines.push('');
  }

  if (values.contact_phone) {
    lines.push('📞 Rückruf:');
    lines.push(values.contact_phone);
    lines.push('');
  }

  lines.push('KI-Rezeption – Ihre digitale Rezeption');

  return lines.join('\n');
}

export function renderWebhookTemplate(payload: any, template: string): string {
  const values = buildWebhookTemplateValues(payload);
  const finalTemplate = template && template.includes('{') ? template : DEFAULT_CALL_TEMPLATE;

  return cleanupRenderedTemplate(
    Object.entries(values).reduce((text, [key, value]) => {
      return text.replaceAll(`{${key}}`, value || '');
    }, finalTemplate)
  );
}

export function buildWebhookTemplateValues(payload: any): Record<string, string> {
  const data = payload?.data || {};
  const call = data?.call || {};
  const contact = data?.contact || {};
  const agent = data?.agent || {};
  const humanEscalation = data?.humanEscalation || data?.human_escalation || {};
  const appointmentRequest = data?.appointmentRequest || data?.appointment_request || {};

  const event = cleanText(payload?.event);
  const direction = cleanText(data?.direction || call?.direction || payload?.direction);
  const contactPhone = cleanText(extractPhoneFromWebhook(payload));
  const toNumber = cleanText(extractBusinessPhoneFromWebhook(payload));
  const durationSeconds = getDurationSeconds(payload);
  const duration = formatDuration(durationSeconds);
  const startedAt = formatGermanTimestamp(data?.startedAt || call?.startedAt || payload?.startedAt);
  const endedAt = formatGermanTimestamp(data?.endedAt || call?.endedAt || payload?.endedAt);
  const timestamp = formatGermanTimestamp(payload?.timestamp || data?.endedAt || call?.endedAt || data?.startedAt || call?.startedAt);

  const summary = cleanText(
    call?.aiSummary ||
      call?.summary ||
      call?.callSummary ||
      data?.aiSummary ||
      data?.summary ||
      data?.callSummary ||
      data?.message ||
      payload?.message
  );

  return {
    event,
    direction,
    status: cleanText(call?.status || data?.status || payload?.status),

    contact_name: cleanText(
      contact?.name ||
        data?.contactName ||
        data?.callerName ||
        data?.customerName ||
        data?.name ||
        data?.caller?.name ||
        data?.customer?.name
    ) || 'Ein Nutzer',
    contact_phone: contactPhone,
    contact_email: cleanText(contact?.email || data?.email || data?.caller?.email || data?.customer?.email),
    company: cleanText(contact?.company || data?.company || data?.caller?.company || data?.customer?.company),
    address: cleanText(contact?.address || data?.address || data?.caller?.address || data?.customer?.address),

    from_number: contactPhone,
    to_number: toNumber,
    phone_number: contactPhone,

    summary,
    ai_summary: summary,
    transcript: cleanText(data?.transcript || call?.transcript || payload?.transcript),
    recording_url: cleanText(call?.recordingUrl || data?.recordingUrl || payload?.recordingUrl),

    duration,
    duration_seconds: durationSeconds !== undefined ? String(durationSeconds) : '',
    duration_minutes: durationSeconds !== undefined ? String(Math.max(1, Math.ceil(durationSeconds / 60))) : '',

    timestamp,
    started_at: startedAt,
    ended_at: endedAt,

    call_id: cleanText(data?.callId || call?.id || call?.callId || payload?.callId),
    conversation_id: cleanText(data?.conversationId || call?.conversationId || payload?.conversationId),
    call_sid: cleanText(data?.callSid || call?.callSid || call?.sid || payload?.callSid),
    agent_id: cleanText(data?.agentId || data?.elevenLabsAgentId || agent?.id || agent?.elevenLabsAgentId || call?.agentId || payload?.agentId),
    agent_name: cleanText(agent?.name || data?.agentName || payload?.agentName),

    escalation_status: cleanText(humanEscalation?.status),
    escalation_intent: cleanText(humanEscalation?.intent),
    escalation_source: cleanText(humanEscalation?.source),
    escalation_requested_at: formatGermanTimestamp(humanEscalation?.requestedAt),

    appointment_status: cleanText(appointmentRequest?.status),
    appointment_intent: cleanText(appointmentRequest?.intent),
    appointment_source: cleanText(appointmentRequest?.source),
    appointment_requested_at: formatGermanTimestamp(appointmentRequest?.requestedAt),

    classification: cleanText(call?.classification || data?.classification),
    sentiment: cleanText(call?.sentiment || data?.sentiment),
  };
}

function cleanupRenderedTemplate(text: string) {
  return (text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      // Remove common placeholder-only lines after their value was empty.
      return !line.match(/^\s*(Name|Telefon|E-Mail|Firma|Adresse|Event|Richtung|Status|Dauer|Klassifizierung|Stimmung|Aufnahme|Call ID|Conversation ID|Call SID|Agent ID|Transkript|Zusammenfassung|Anrufer|Angerufene Nummer|Rückruf|Anliegen|Gesprächsauszug|Agent):\s*$/i);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPhoneFromWebhook(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload.data || {};
  const direction = cleanText(data?.direction || data?.call?.direction || payload?.direction).toLowerCase();

  if (direction === 'outbound') {
    return (
      data?.toNumber ||
      data?.call?.toNumber ||
      data?.phoneNumber ||
      data?.call?.phoneNumber ||
      data?.contact?.phone ||
      data?.phone ||
      data?.call?.phone ||
      data?.caller?.phone ||
      data?.customer?.phone ||
      payload?.toNumber ||
      payload?.phoneNumber ||
      ''
    );
  }

  return (
    data?.fromNumber ||
    data?.call?.fromNumber ||
    data?.phoneNumber ||
    data?.call?.phoneNumber ||
    data?.contact?.phone ||
    data?.phone ||
    data?.call?.phone ||
    data?.caller?.phone ||
    data?.customer?.phone ||
    payload?.fromNumber ||
    payload?.phoneNumber ||
    ''
  );
}

export function extractContactNameFromWebhook(payload: any): string {
  const values = buildWebhookTemplateValues(payload);
  return values.contact_name === 'Ein Nutzer' ? '' : values.contact_name;
}

export function extractBusinessPhoneFromWebhook(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload.data || {};
  const direction = cleanText(data?.direction || data?.call?.direction || payload?.direction).toLowerCase();

  if (direction === 'outbound') {
    return data?.fromNumber || data?.call?.fromNumber || data?.businessNumber || data?.agentNumber || data?.toNumber || data?.call?.toNumber || '';
  }

  return data?.toNumber || data?.call?.toNumber || data?.businessNumber || data?.agentNumber || payload?.toNumber || '';
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

function getDurationSeconds(payload: any): number | undefined {
  const data = payload?.data || {};
  const call = data?.call || {};

  const directSeconds = firstNumber(
    data?.durationSeconds,
    call?.durationSeconds,
    data?.duration,
    call?.duration,
    payload?.durationSeconds,
    payload?.duration
  );

  if (directSeconds !== undefined) return Math.max(0, Math.round(directSeconds));

  const directMinutes = firstNumber(call?.durationMinutes, data?.durationMinutes, payload?.durationMinutes);
  if (directMinutes !== undefined) return Math.max(0, Math.round(directMinutes * 60));

  const started = parseWebhookDate(data?.startedAt || call?.startedAt || payload?.startedAt);
  const ended = parseWebhookDate(data?.endedAt || call?.endedAt || payload?.endedAt);

  if (started && ended && ended.getTime() >= started.getTime()) {
    return Math.round((ended.getTime() - started.getTime()) / 1000);
  }

  return undefined;
}

function firstNumber(...values: any[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function formatDuration(seconds?: number) {
  if (seconds === undefined) return '';
  if (seconds < 60) return `${seconds} Sekunden`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  if (restSeconds === 0) return `${minutes} Minuten`;
  return `${minutes} Minuten ${restSeconds} Sekunden`;
}

function formatGermanTimestamp(timestamp: any) {
  const date = parseWebhookDate(timestamp);
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' Uhr';
  } catch {
    return date.toISOString();
  }
}

function parseWebhookDate(value: any): Date | null {
  if (!value) return null;

  try {
    const date = typeof value === 'string' ? parseISO(value) : new Date(value);
    return isValid(date) ? date : null;
  } catch {
    return null;
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

function translateDirection(direction: string) {
  const normalized = direction.toLowerCase();
  if (normalized === 'inbound') return 'Eingehend';
  if (normalized === 'outbound') return 'Ausgehend';
  return direction;
}

const DEFAULT_CALL_TEMPLATE = `📞 Neuer Anruf eingegangen

Event: {event}
Richtung: {direction}
Status: {status}
Dauer: {duration}

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}
E-Mail: {contact_email}
Firma: {company}

📞 Nummern:
Anrufer: {from_number}
Angerufene Nummer: {to_number}

🕒 Zeitpunkt:
{timestamp}

📝 Zusammenfassung:
{summary}

💬 Transkript:
{transcript}

🔗 Aufnahme:
{recording_url}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent ID: {agent_id}

📞 Rückruf:
{contact_phone}

KI-Rezeption – Ihre digitale Rezeption`;
