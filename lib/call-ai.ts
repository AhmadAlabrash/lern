import { buildWebhookTemplateValues } from './message';
import type { CallNotificationKind } from './call-notification-dedupe';

const OPENAI_ANALYSIS_TIMEOUT_MS = 3500;

type SettingsMap = Record<string, string | undefined>;

type SmartHumanSupportAnalysis = {
  used: boolean;
  payload: any;
  needsHumanSupport?: boolean;
  reasonDe?: string;
  confidence?: number;
  error?: string;
};

/**
 * OpenAI fallback for completed calls that did not send a dedicated
 * human_escalation.requested event in time.
 *
 * This is intentionally used only for call_completed notifications and only
 * when the admin enables it. It can translate the aiSummary and classify the
 * call in the same OpenAI request, so it does not add a second translation call
 * when Translation provider = OpenAI.
 */
export async function analyzeCompletedCallWithOpenAI(
  payload: any,
  settings: SettingsMap,
  eventName: string,
  kind: CallNotificationKind
): Promise<SmartHumanSupportAnalysis> {
  if (!shouldAnalyzeWithOpenAI(settings, eventName, kind)) {
    return { used: false, payload };
  }

  const apiKey = getOpenAIApiKey(settings);
  if (!apiKey) {
    return { used: false, payload, error: 'missing_openai_api_key' };
  }

  const values = buildWebhookTemplateValues(payload);
  const summary = values.summary || '';
  const callerTranscript = extractCallerTranscript(values.transcript || '');

  if (!summary.trim() && !callerTranscript.trim()) {
    return { used: false, payload, error: 'missing_summary_and_caller_transcript' };
  }

  try {
    const model = (settings['openai.analysis_model'] || settings['openai.translation_model'] || process.env.OPENAI_ANALYSIS_MODEL || process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini').trim();
    const confidenceThreshold = numberSetting(settings['ai.human_support_confidence_threshold'], 0.6);

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You analyze completed phone-call webhook notifications for a German business.',
              'Return ONLY valid JSON with these keys:',
              '{"translatedSummaryDe":"string","needsHumanSupport":boolean,"reasonDe":"string","confidence":number}',
              '',
              'Task 1: Translate the call summary into natural, professional German.',
              'Task 2: Decide whether the caller still needs a human employee to follow up.',
              '',
              'Set needsHumanSupport=true only when the caller clearly still needs a human, for example:',
              '- the caller asked to speak with a human/person/employee/operator/representative',
              '- the caller asked for a callback from a real person',
              '- the issue is unresolved and cannot be completed by an automated booking/SMS/link flow',
              '- complaint, urgent issue, anger, confusion, or an explicit request for manual handling',
              '',
              'Set needsHumanSupport=false when the call is complete or an automated next step is enough, for example:',
              '- the caller asked for a booking link and the system will send it',
              '- the caller only asked a basic question and the agent answered',
              '- the caller thanked the agent or ended without asking for a person',
              '',
              'Do not mark true merely because the transcript contains the label AGENT.',
              'If unsure, prefer false unless there is a clear unresolved human-follow-up need.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              event: eventName,
              status: values.status,
              duration: values.duration,
              phone: values.contact_phone,
              aiSummary: summary.slice(0, 2500),
              callerTranscript: callerTranscript.slice(0, 3500),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await safeReadResponseText(response);
      return { used: false, payload, error: `openai_${response.status}${details ? `_${details}` : ''}`.slice(0, 250) };
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObject(content);

    if (!parsed) {
      return { used: false, payload, error: 'invalid_openai_json' };
    }

    const confidence = clamp01(Number(parsed.confidence ?? 0));
    const needsHumanSupport = Boolean(parsed.needsHumanSupport) && confidence >= confidenceThreshold;
    const translatedSummaryDe = typeof parsed.translatedSummaryDe === 'string' ? parsed.translatedSummaryDe.trim() : '';
    const reasonDe = typeof parsed.reasonDe === 'string' ? parsed.reasonDe.trim() : '';

    const updatedPayload = applySmartAnalysisToPayload(payload, {
      translatedSummaryDe: translatedSummaryDe || summary,
      needsHumanSupport,
      reasonDe,
      confidence,
    });

    return {
      used: true,
      payload: updatedPayload,
      needsHumanSupport,
      reasonDe,
      confidence,
    };
  } catch (error) {
    console.error('OpenAI call analysis failed:', error);
    return { used: false, payload, error: getErrorMessage(error) };
  }
}

export function shouldAnalyzeWithOpenAI(settings: SettingsMap, eventName: string, kind: CallNotificationKind) {
  if (kind !== 'call_completed') return false;

  const event = String(eventName || '').trim();
  if (event !== 'inbound_call.completed' && event !== 'outbound_call.completed') return false;

  if (!boolSetting(settings['ai.human_support_detection_enabled'], true)) return false;

  // This keeps cost predictable: the smart decision is bundled with OpenAI
  // translation. If the admin chooses DeepL or Off, the app does not make a
  // separate OpenAI request just for classification.
  return String(settings['translation.provider'] || '').trim().toLowerCase() === 'openai';
}

function getOpenAIApiKey(settings: SettingsMap) {
  return (settings['openai.api_key'] || process.env.OPENAI_API_KEY || '').trim();
}

function applySmartAnalysisToPayload(payload: any, analysis: { translatedSummaryDe: string; needsHumanSupport: boolean; reasonDe: string; confidence: number }) {
  const copy = clonePayload(payload);

  if (!copy.data || typeof copy.data !== 'object') copy.data = {};

  const summary = analysis.translatedSummaryDe;
  if (summary) {
    if (copy.data.call && typeof copy.data.call === 'object') {
      copy.data.call.aiSummary = summary;
      if (copy.data.call.summary !== undefined) copy.data.call.summary = summary;
      if (copy.data.call.callSummary !== undefined) copy.data.call.callSummary = summary;
    }

    if (copy.data.aiSummary !== undefined) copy.data.aiSummary = summary;
    if (copy.data.summary !== undefined) copy.data.summary = summary;
    if (copy.data.callSummary !== undefined) copy.data.callSummary = summary;
    if (copy.message !== undefined) copy.message = summary;
  }

  copy.data.aiHumanSupport = {
    needed: analysis.needsHumanSupport,
    reason: analysis.reasonDe,
    confidence: analysis.confidence,
    source: 'openai_completed_call_analysis',
  };

  return copy;
}

function extractCallerTranscript(transcript: string) {
  const text = String(transcript || '').trim();
  if (!text) return '';

  const callerLines = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => /^(USER|CALLER|KUNDE|ANRUFER)\s*\(/i.test(line) || /^(USER|CALLER|KUNDE|ANRUFER)\s*:/i.test(line));

  if (callerLines.length > 0) return callerLines.join('\n');

  // If no speaker labels are present, fall back to a short excerpt. Do not send
  // unbounded transcripts to control cost.
  return text.slice(0, 3500);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_ANALYSIS_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeReadResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function parseJsonObject(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function clonePayload(payload: any) {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
}

function boolSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function numberSetting(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
