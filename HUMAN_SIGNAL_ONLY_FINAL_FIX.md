# Human signal only final fix

This version changes the flow completely:

- `human_escalation.requested` does **not** send Email/Telegram anymore.
- It only stores a signal in Supabase by `user_id + callId`.
- `inbound_call.completed` is the only event that sends the final call notification.
- Before sending, it waits for `dedupe.human_signal_settle_ms` (default 12000 ms), checks if a human signal exists for the same call id, and uses the correct template:
  - human signal exists OR OpenAI says human support is needed → human escalation template
  - no human signal AND OpenAI says no → normal “Neuer Anruf” template

This keeps the hybrid logic but removes the duplicate source.

## Required SQL

Run once in Supabase SQL Editor:

```sql
-- file: supabase-human-signal-only-final.sql
```

## Admin settings

Keep both events in routing if you want, but the code will treat `human_escalation.requested` as a signal only:

Email events:

```text
inbound_call.completed
human_escalation.requested
appointment.requested
appointment.needed
```

Telegram events can be the same.

OpenAI settings:

```text
Translation provider: OpenAI
Smart human support detection: ON
Translate AI summary: ON
Translate transcript: OFF
```

## Monitor values

In `webhook_event_receipts.delivery`, check:

```text
human_signal: stored_signal_only | signal_found | no_signal
human_signal_wait_ms: 12000
notification_kind: human_escalation_signal | human_escalation_openai | call_completed
email: sent | signal_only_no_notification | event_not_enabled | ...
telegram: sent | signal_only_no_notification | event_not_enabled | ...
```
