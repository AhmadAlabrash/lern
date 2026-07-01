# One call = one notification fix

This fix prevents duplicate Email/Telegram notifications when the same call sends both:

- `inbound_call.completed`
- `human_escalation.requested`

## What changed

The old logic delayed `inbound_call.completed`, then reserved the call notification. If `human_escalation.requested` arrived after the plain call notification was already sent, the user could receive two notifications.

The new logic reserves `inbound_call.completed` first as a pending low-priority notification, then waits. If `human_escalation.requested` arrives during that wait with the same call ID, it upgrades the pending reservation and sends the human escalation template. When the plain call wakes up, it sees the reservation was upgraded and suppresses itself.

## Required SQL

Run once in Supabase SQL Editor:

```sql
-- file: supabase-one-call-one-notification-fix.sql
```

This sets:

```text
dedupe.call_completed_hold_ms = 8000
```

## Behavior

Normal call:

```text
inbound_call.completed only -> 📞 Neuer Anruf
```

Human escalation call:

```text
inbound_call.completed + human_escalation.requested with same callId -> 🚨 Menschliche Hilfe angefragt only
```

SMS is not blocked by this dedupe table.

## Tuning

If you still get two notifications, increase `dedupe.call_completed_hold_ms` to `10000` or `12000`.

If the sender starts showing webhook timeout/failure, reduce it to `6000`.
