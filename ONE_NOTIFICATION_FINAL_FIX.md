# Final duplicate-killer fix

This version adds a second guard for the duplicate notification problem:

- `webhook_notification_receipts` still locks one Email/Telegram notification per `user_id + callId`.
- `webhook_event_receipts` is now also checked before a plain `inbound_call.completed` notification is sent.

That means when the app receives both:

- `human_escalation.requested`
- `inbound_call.completed`

for the same `callId`, it sends only one Email/Telegram notification. If the human event exists, the normal completed-call notification is suppressed even if an older notification-lock migration was missing.

Run `supabase-one-notification-final-fix.sql` once after deploying.
