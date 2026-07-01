-- Run these queries in Supabase SQL Editor to debug SMS delivery.

-- 1) Check whether appointment.requested is enabled for SMS routing.
select key, value
from public.app_settings
where key in ('routing.sms_events', 'plan.free_sms_limit', 'plan.pro_sms_limit', 'plan.ultimate_sms_limit', 'twilio.account_sid', 'twilio.messaging_service_sid');

-- 2) Ensure appointment.requested is in SMS routing.
update public.app_settings
set value = case
  when value like '%appointment.requested%' then value
  else coalesce(value, '') || E'\nappointment.requested'
end,
updated_at = now()
where key = 'routing.sms_events';

-- 3) Check the user settings. SMS will not send if plan is free and free limit is 0.
select id, email, notify_sms, sms_provider, plan, booking_url, whatsapp_number
from public.webhook_users
order by created_at desc;

-- 4) Check the last webhook deliveries and see delivery.sms status.
-- Look for: sent_1/200, missing_phone, event_not_enabled, monthly_limit_reached_0/0, failed, disabled_for_user.
select event, external_id, status, delivery, first_received_at, last_received_at
from public.webhook_event_receipts
order by first_received_at desc
limit 20;

-- Optional: set a test user to pro. Replace the email first.
-- update public.webhook_users set plan = 'pro' where email = 'YOUR_USER_EMAIL@example.com';
