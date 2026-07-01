-- ---------------------------------------------------------------------------
-- Event-only template selection fix.
--
-- The app must choose the notification template based on payload.event only:
-- - inbound_call.completed        -> normal call template
-- - human_escalation.requested    -> human escalation template
-- - appointment.requested/needed  -> appointment/request action handling
--
-- This SQL is optional but recommended: it makes the hold time a bit safer so
-- the normal inbound_call.completed notification waits briefly for a possible
-- human_escalation.requested event from the same call.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_completed_hold_ms', '5000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
