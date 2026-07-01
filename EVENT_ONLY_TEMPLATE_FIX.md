# Event-only template selection fix

This version fixes a wrong behavior where a normal `inbound_call.completed` event could still use the `human_escalation.requested` template.

The rule is now strict:

- `inbound_call.completed` → normal call template
- `human_escalation.requested` → human escalation template
- `appointment.requested` / `appointment.needed` → appointment handling / SMS routing

The app no longer scans transcript or aiSummary to decide the template type. This avoids false positives.

## Recommended SQL

Run once in Supabase SQL Editor:

```sql
-- file: supabase-event-only-template-fix.sql
```

This sets `dedupe.call_completed_hold_ms` to `5000` ms. The delay gives the app a short window to receive a more important event for the same call ID before sending the normal call notification.

## Important

If `human_escalation.requested` arrives after the normal call notification was already sent, Gmail/Telegram cannot unsend the previous notification. Increase the hold time in Admin Dashboard if your post-call event usually arrives later.
