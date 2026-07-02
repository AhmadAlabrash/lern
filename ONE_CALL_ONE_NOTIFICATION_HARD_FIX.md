# One call / one notification hard fix

This version fixes the case where the app sends both:

- `🚨 Menschliche Hilfe angefragt`
- `📞 Neuer Anruf`

for the same real call.

## What changed

The dedupe now checks by `user_id + callId/conversationId/callSid` before inserting anything. It no longer depends only on a unique `notification_key` insert error.

So these two payloads are treated as the same call:

- `human_escalation.requested` with `data.call.id`
- `inbound_call.completed` with `data.callId`

If one was already sent, the second one is suppressed.

## Required SQL

After deploying, run:

```sql
supabase-cross-event-one-notification-hard-fix.sql
```

This cleans old duplicate rows and adds a unique index on `(user_id, group_id)`.

## Test

Send the two events with the same call id:

```text
04a03c12-c977-4517-800f-51fae3999da5
```

Expected result: only one Email/Telegram notification.

SMS is not blocked by this table.
