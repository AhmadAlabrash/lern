# Human escalation false positive fix

Problem:
Normal `inbound_call.completed` events were sometimes rendered with the `🚨 Menschliche Hilfe angefragt` template.

Cause:
The intent detector searched for the word `agent` inside the whole transcript/summary. ElevenLabs transcripts always contain speaker labels like:

```text
AGENT (0s): ...
```

So every normal call looked like it contained the keyword `agent`, and the system chose the human escalation template.

Fix:
- Removed the generic `agent` keyword from human-escalation detection.
- Human detection now checks only strong human-request phrases, such as `human`, `operator`, `representative`, `talk to someone`, `mitarbeiter sprechen`, etc.
- Transcript intent detection now only reads caller lines like `USER:` / `CALLER:` / `KUNDE:` and ignores `AGENT:` lines.

No Supabase SQL change is required for this fix if you already ran the previous human escalation SQL.

After deploy:
- New normal calls should use the normal call template.
- Calls with `human_escalation.requested` should use the human escalation template.
- If testing an old event with the same call ID, delete its existing rows from `webhook_event_receipts` and `webhook_notification_receipts`, or make a new call.
