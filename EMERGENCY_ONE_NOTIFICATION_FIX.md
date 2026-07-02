# Emergency one-notification fix

This fix stops the duplicate Human notifications without depending only on the database dedupe lock.

## Root cause

When both events arrive for the same call:

1. `human_escalation.requested` sends the Human template.
2. `inbound_call.completed` is also analyzed by OpenAI.
3. OpenAI correctly detects that the caller wanted a human.
4. The completed-call event is converted to the Human template too.
5. Result: two Human notifications.

## New rule

`human_escalation.requested` is the source of truth for Human notifications.

If `inbound_call.completed` is analyzed by OpenAI and OpenAI says `needsHumanSupport = true`, the completed-call notification is suppressed instead of sending a second Human template.

That means:

- Human event → sends Human template.
- Normal completed call → sends normal call template.
- Completed call where OpenAI sees human support → suppressed, because the Human event should handle it.

This also works if the Supabase dedupe SQL was not installed correctly, because it does not rely on the receipt tables for this specific duplicate path.

## After deploying

Make a new call.
Do not test using Retry on an old call.

Expected result for a human request call:

- One notification only: `🚨 Menschliche Hilfe angefragt`
