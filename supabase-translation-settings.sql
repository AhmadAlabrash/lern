-- Add admin-controlled translation settings for existing installations.
-- Run once in Supabase SQL Editor after deploying the new code.

insert into public.app_settings (key, value, updated_at) values
  ('translation.provider', 'off', now()),
  ('translation.translate_ai_summary', 'true', now()),
  ('translation.translate_transcript', 'false', now()),
  ('translation.target_lang', 'DE', now()),
  ('openai.api_key', '', now()),
  ('openai.translation_model', 'gpt-4o-mini', now()),
  ('deepl.api_key', '', now()),
  ('deepl.api_url', '', now())
on conflict (key) do nothing;
