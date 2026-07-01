# Human escalation notification fix

This version adds support for `human_escalation.requested` without sending two Email/Telegram notifications for the same call.

## What changed

- Added `human_escalation.requested` to Email and Telegram routing defaults.
- Added separate admin-editable templates:
  - `template.telegram.human_escalation`
  - `template.email.human_escalation`
- Added smart cross-event dedupe for Email/Telegram call notifications.
  - If `inbound_call.completed` and `human_escalation.requested` arrive for the same `call.id`, only one Email/Telegram notification is sent.
  - SMS is not blocked by this logic, so `appointment.requested` can still send an SMS follow-up.
- Added a short delay for plain `inbound_call.completed` notifications:
  - setting: `dedupe.call_completed_hold_ms`
  - default: `3000`
  - this gives specific post-call events time to arrive first.
- If a plain `inbound_call.completed` already contains text like “talk to human” / “speak to a human” / “Mitarbeiter sprechen”, it uses the human escalation template directly.

## Required SQL

Run this once in Supabase SQL Editor after deployment:

```sql
-- file: supabase-human-escalation-dedupe.sql
```

## Admin dashboard

Go to:

```text
Admin Dashboard → Routing & API → Messages
```

You can edit the new human escalation email/Telegram templates there.

Go to:

```text
Admin Dashboard → Routing & API → Event Routing
```

Make sure Email and Telegram events include:

```text
human_escalation.requested
```

Recommended smart duplicate delay:

```text
3000 ms
```

Set it to `0` only if you want immediate normal call-completed notifications and accept that a later human event may be suppressed.
