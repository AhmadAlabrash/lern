# Atomic one-call queue fix

This is the new duplicate fix. It does not use the old receipt logic.

## Rule

One `user_id` + one `callId` / `conversationId` / `callSid` = one Email/Telegram notification.

## Behavior

- Only `inbound_call.completed` arrives: waits 10 seconds, then sends `📞 Neuer Anruf`.
- `human_escalation.requested` + `inbound_call.completed` arrive for same call: waits 10 seconds, then sends only one `🚨 Menschliche Hilfe angefragt`.
- If only `inbound_call.completed` arrives but OpenAI detects human support is still needed: sends one Human template, not two.
- SMS is not merged by this queue, so appointment SMS still works normally.

## Required SQL

Run this once in Supabase SQL Editor after deploying:

`supabase-atomic-call-notification-queue.sql`

## Important

Do not test using old Retry events after deploy. Make one new call.

If the second event arrives later than 10 seconds, increase:

```sql
update public.app_settings
set value = '12000', updated_at = now()
where key = 'dedupe.call_notification_settle_ms';
```
