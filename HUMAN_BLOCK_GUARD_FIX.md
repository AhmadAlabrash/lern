# Human-block guard fix

This version replaces the previous queue/RPC dedupe with a simpler hard guard:

- `human_escalation.requested` sends the Human template immediately and writes a block for the same `callId` for 2 minutes.
- `inbound_call.completed` waits 12 seconds. If the Human event/block appeared, it sends nothing. If not, it sends one normal `Neuer Anruf` notification.
- If OpenAI detects human support from `inbound_call.completed`, it still sends only one notification because it must claim the same guard row first.
- SMS remains independent and is not blocked by this table.

Run this SQL once in Supabase:

```sql
supabase-human-block-call-guard.sql
```

Test with new calls only, not retries from old calls.
