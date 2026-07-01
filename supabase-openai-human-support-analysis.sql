-- ---------------------------------------------------------------------------
-- OpenAI smart human-support fallback for completed call notifications
-- ---------------------------------------------------------------------------
-- Run once after deploying this version.
--
-- Behavior:
-- - human_escalation.requested event is still the main/source-of-truth signal.
-- - If only inbound_call.completed arrives, the app waits briefly.
-- - If no higher-priority event arrives, OpenAI can translate the aiSummary and
--   decide whether the caller still needs a human follow-up.
-- - If yes, the app sends the human escalation template instead of the normal
--   "Neuer Anruf" template.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, updated_at) values
  ('ai.human_support_detection_enabled', 'true', now()),
  ('ai.human_support_confidence_threshold', '0.6', now()),
  ('openai.analysis_model', '', now())
on conflict (key) do nothing;

-- Keep this below Vercel timeout risk. OpenAI analysis adds up to ~3.5 seconds,
-- so 5000 ms is a safer starting point than 8000+ ms.
insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_completed_hold_ms', '5000', now())
on conflict (key) do update
set value = case
  when public.app_settings.value is null or public.app_settings.value = '' then excluded.value
  when public.app_settings.value ~ '^\d+$' and public.app_settings.value::integer > 7000 then excluded.value
  else public.app_settings.value
end,
updated_at = now();

-- Optional: show the AI reason inside the human escalation template if the
-- template does not already have this placeholder.
update public.app_settings
set value = replace(
  value,
  E'📝 Anliegen:\n{summary}\n\n💬 Gesprächsauszug:',
  E'📝 Anliegen:\n{summary}\n\n🤖 KI Einschätzung:\n{human_support_reason}\n\n💬 Gesprächsauszug:'
),
updated_at = now()
where key in ('template.telegram.human_escalation', 'template.email.human_escalation')
  and value is not null
  and value not like '%{human_support_reason}%';
