# OpenAI Human Support Analysis Fix

This version adds an OpenAI fallback for completed call notifications.

## What it does

The source-of-truth event logic stays unchanged:

- `human_escalation.requested` => human escalation template
- `appointment.requested` / `appointment.needed` => appointment/SMS flow
- `inbound_call.completed` => normal call template, unless OpenAI detects the caller still needs a human

For `inbound_call.completed`, the app waits briefly for a higher-priority event with the same `callId`. If none arrives, and admin settings use `Translation provider = OpenAI`, the app sends one OpenAI request that:

1. translates `aiSummary` into German, and
2. returns `needsHumanSupport: true/false`.

If `needsHumanSupport=true`, the app sends the human escalation template instead of the normal call template.

## Admin settings

Go to Admin Dashboard → Translation:

- Translation provider: `OpenAI`
- Translate AI summary: ON
- Translate transcript: usually OFF
- Smart human support detection: ON
- OpenAI API key: set your key
- Translation model: `gpt-4o-mini` or a cheaper small OpenAI model you use
- Analysis model optional: leave empty to use the translation model
- Confidence threshold: `0.6`

## SQL

Run once in Supabase SQL Editor:

```sql
-- file: supabase-openai-human-support-analysis.sql
```

## Notes

DeepL is still supported for translation, but DeepL will not do human-support classification. The smart decision runs only when provider is OpenAI, so the cost stays bundled with the translation request.
