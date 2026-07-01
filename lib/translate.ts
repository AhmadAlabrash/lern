/**
 * Optional translation layer for webhook notifications.
 *
 * Admin settings decide:
 * - provider: off | openai | deepl
 * - which fields to translate: aiSummary/summary and/or transcript
 *
 * Delivery must never fail just because translation failed, so every error falls
 * back to the original payload.
 */

const TRANSLATION_TIMEOUT_MS = 5000;

type SettingsMap = Record<string, string | undefined>;
type TranslationProvider = 'deepl' | 'openai';

type FieldPath = Array<string>;

const SUMMARY_FIELD_PATHS: FieldPath[] = [
  ['message'],
  ['data', 'message'],
  ['data', 'aiSummary'],
  ['data', 'summary'],
  ['data', 'callSummary'],
  ['data', 'call', 'summary'],
];

const TRANSCRIPT_FIELD_PATHS: FieldPath[] = [
  ['transcript'],
  ['data', 'transcript'],
  ['data', 'call', 'transcript'],
];

export async function translateWebhookPayloadToGerman(payload: any, settings: SettingsMap = {}): Promise<any> {
  const providerSetting = normalizeProvider(settings['translation.provider']);

  // Backwards-compatible fallback for older deployments that used only env vars.
  const legacyEnvEnabled = process.env.TRANSLATE_NOTIFICATIONS_TO_DE === 'true';
  const provider = providerSetting || (legacyEnvEnabled ? getProviderFromEnvironment() : null);

  if (!provider) return payload;

  if (!payload || typeof payload !== 'object') return payload;

  const translatedPayload = clonePayload(payload);
  const fieldsToTranslate = buildFieldList(settings, legacyEnvEnabled);

  if (fieldsToTranslate.length === 0) return payload;

  for (const path of fieldsToTranslate) {
    const original = getValueAtPath(translatedPayload, path);

    if (!shouldTranslate(original)) continue;

    try {
      const translated = await translateTextToGerman(String(original), provider, settings);
      if (translated) setValueAtPath(translatedPayload, path, translated);
    } catch (error) {
      console.error(`German translation failed for ${path.join('.')}:`, error);
      // Keep the original field and continue. Webhook delivery should not fail.
    }
  }

  return translatedPayload;
}

function normalizeProvider(value: string | undefined): TranslationProvider | null {
  const provider = (value || '').trim().toLowerCase();
  if (provider === 'deepl' || provider === 'openai') return provider;
  return null;
}

function getProviderFromEnvironment(): TranslationProvider | null {
  if (process.env.DEEPL_API_KEY) return 'deepl';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function buildFieldList(settings: SettingsMap, legacyEnvEnabled: boolean): FieldPath[] {
  const translateSummary = boolSetting(settings['translation.translate_ai_summary'], legacyEnvEnabled || true);
  const translateTranscript = boolSetting(settings['translation.translate_transcript'], legacyEnvEnabled);

  const fields: FieldPath[] = [];

  if (translateSummary) fields.push(...SUMMARY_FIELD_PATHS);
  if (translateTranscript) fields.push(...TRANSCRIPT_FIELD_PATHS);

  return fields;
}

function boolSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

async function translateTextToGerman(text: string, provider: TranslationProvider, settings: SettingsMap): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  if (provider === 'deepl') {
    return translateWithDeepL(trimmed, settings);
  }

  return translateWithOpenAI(trimmed, settings);
}

async function translateWithDeepL(text: string, settings: SettingsMap): Promise<string> {
  const apiKey = (settings['deepl.api_key'] || process.env.DEEPL_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('DeepL provider is selected but deepl.api_key is empty.');
  }

  const apiUrl = (settings['deepl.api_url'] || process.env.DEEPL_API_URL || guessDeepLApiUrl(apiKey)).trim();
  const targetLang = (settings['translation.target_lang'] || 'DE').trim() || 'DE';

  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLang,
      preserve_formatting: true,
      context: 'Business call notification for a German company. Keep phone numbers, URLs, IDs and timestamps unchanged.',
    }),
  });

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`DeepL translation failed with status ${response.status}${details ? `: ${details}` : ''}`);
  }

  const json = await response.json();
  return json?.translations?.[0]?.text?.trim() || text;
}

async function translateWithOpenAI(text: string, settings: SettingsMap): Promise<string> {
  const apiKey = (settings['openai.api_key'] || process.env.OPENAI_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('OpenAI provider is selected but openai.api_key is empty.');
  }

  const model = (settings['openai.translation_model'] || process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini').trim();

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Translate the user text into natural, professional German for a German business call notification. Preserve phone numbers, URLs, IDs, dates, times, and technical event names. In transcripts, keep timestamps like (0s). Translate speaker labels AGENT to KI and USER/CALLER to ANRUFER when present. Return only the translated text.',
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`OpenAI translation failed with status ${response.status}${details ? `: ${details}` : ''}`);
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content?.trim() || text;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

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

function guessDeepLApiUrl(apiKey: string) {
  // DeepL free API keys usually end with :fx.
  return apiKey.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
}

function shouldTranslate(value: any) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 3) return false;
  if (!/[A-Za-zÄÖÜäöüß]/.test(text)) return false;
  return true;
}

function clonePayload(payload: any) {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
}

function getValueAtPath(object: any, path: string[]) {
  return path.reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), object);
}

function setValueAtPath(object: any, path: string[], value: string) {
  let current = object;

  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== 'object') return;
    current = current[key];
  }

  current[path[path.length - 1]] = value;
}
