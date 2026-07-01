# Call webhook notification fix

## What was wrong

1. The webhook endpoint was receiving `inbound_call.completed` correctly and returning HTTP 200, but the global routing settings did not include `inbound_call.completed`, so email/Telegram were skipped.
2. The message renderer expected the old test payload shape:

```json
{
  "data": {
    "contact": { "name": "...", "phone": "..." },
    "call": { "summary": "...", "durationMinutes": 2 }
  }
}
```

The real call payload uses fields like `fromNumber`, `toNumber`, `duration`, `aiSummary`, `transcript`, `startedAt`, and `endedAt`.

## What changed

- Added real call event routing for email and Telegram:
  - `inbound_call.completed`
  - `inbound_call.failed`
  - `inbound_call.missed`
- Added support for the real call payload fields:
  - caller number from `data.fromNumber` / `data.phoneNumber`
  - business number from `data.toNumber`
  - summary from `data.aiSummary`
  - transcript from `data.transcript`
  - duration from `data.duration` in seconds
  - Berlin time formatting for timestamps
- Added new placeholders:
  - `{from_number}`
  - `{to_number}`
  - `{duration}`
  - `{duration_seconds}`
  - `{transcript}`
  - `{call_id}`
  - `{conversation_id}`
  - `{call_sid}`
  - `{agent_id}`
  - `{started_at}`
  - `{ended_at}`

## Required deployment steps

1. Deploy the updated project code to Vercel.
2. Run `supabase-call-webhook-fix.sql` once in Supabase SQL Editor.
3. In the admin dashboard, check **Routing & API → Event Routing**:
   - Email events should include `inbound_call.completed`.
   - Telegram events should include `inbound_call.completed` if Telegram is used.
4. Make a new test call. The email should show the real caller number, real summary, real transcript, real duration, and the correct Berlin time.

## Important note

The webhook provider delivery log showing status `200` only means your app received the event. It does not prove that your app sent an email. Before this fix, the app returned `200` but skipped delivery because the event name was not enabled in routing.
