# KI-Rezeption Webhook Notification Center

A simple Next.js admin dashboard for routing webhook events to Telegram, email and SMS.

## Main features

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase PostgreSQL storage
- Admin login with HTTP-only cookie
- Webhook users with secret Bearer tokens
- Telegram notifications
- Email notifications via SMTP
- SMS follow-up via Twilio Messaging Service SID
- Telegram `/start` webhook that replies with the user's `chat_id`
- Centralized admin settings:
  - global event routing for Telegram / email / SMS
  - global message templates for Telegram / email / SMS
  - SMTP / Telegram / Twilio credentials from dashboard settings with `.env` fallback

## Install locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:3000/admin/login
```

## Required environment variables

Copy `.env.example` to `.env` and fill the required values.

Important server-only secrets:

```env
SUPABASE_SERVICE_ROLE_KEY=
SMTP_PASS=
TELEGRAM_BOT_TOKEN=
TWILIO_AUTH_TOKEN=
SESSION_SECRET=
```

Do not expose these values in client-side code.

## Supabase setup

Run the SQL file in Supabase SQL Editor:

```sql
-- see supabase.sql
```

This creates:

- `webhook_users`
- `app_settings`
- update triggers
- safe upgrade columns for existing projects

## Global event routing

In the admin dashboard, open **Routing & API → Event Routing**.

Each channel has a list of event names, one per line.

Example Telegram / email events:

```text
webhook.test
inbound_call.completed
inbound_call.failed
inbound_call.missed
appointment.needed
appointment.confirmed
appointment.cancelled
appointment.canceled
```

Example SMS events:

```text
appointment.needed
```

SMS should usually stay limited to:

```text
appointment.needed
```

Use `*` if you want a channel to run for all event names.

## Global templates

Open **Routing & API → Messages**.

Available placeholders:

```text
{event}
{direction}
{status}
{duration}
{duration_seconds}
{duration_minutes}
{contact_name}
{contact_phone}
{contact_email}
{company}
{address}
{from_number}
{to_number}
{phone_number}
{summary}
{ai_summary}
{transcript}
{recording_url}
{timestamp}
{started_at}
{ended_at}
{call_id}
{conversation_id}
{call_sid}
{agent_id}
{classification}
{sentiment}
{booking_url}
{whatsapp_link}
{whatsapp_number}
```

SMS example:

```text
Danke für deinen Anruf. Deinen Termin kannst du hier buchen: {booking_url} Für weitere Hilfe erreichst du uns auf WhatsApp: {whatsapp_link}
```

## Dashboard credentials

The **Routing & API → API Credentials** tab stores SMTP, Telegram and Twilio values in Supabase `app_settings`.

If a dashboard setting is empty, the app falls back to `.env` / Vercel Environment Variables.

Security note: storing credentials in Supabase is convenient for runtime editing, but it means the credentials are stored in your database. Keep admin access protected and rotate secrets if needed.

## Telegram chat_id flow

The route is:

```text
/api/telegram/webhook
```

Set Telegram webhook:

```powershell
$botToken="YOUR_TELEGRAM_BOT_TOKEN"
$appUrl="https://your-domain.vercel.app"
$secret="YOUR_TELEGRAM_WEBHOOK_SECRET"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Body @{
    url="$appUrl/api/telegram/webhook"
    secret_token="$secret"
  }
```

Then the user opens the bot and presses `/start`. The bot replies with their Telegram `chat_id`.

## Webhook endpoint

```text
POST /api/webhook
```

Example:

```bash
curl -X POST "https://your-domain.vercel.app/api/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_SECRET_HERE" \
  -d '{
    "event": "appointment.needed",
    "timestamp": "2026-06-14T14:31:19.929Z",
    "data": {
      "contact": {
        "name": "Test User",
        "phone": "+491701234567",
        "email": "test@example.com",
        "company": "Test Company Inc."
      },
      "call": {
        "status": "completed",
        "durationMinutes": 2,
        "classification": "Warm Lead",
        "sentiment": "positive",
        "summary": "Der Kontakt möchte einen Termin buchen.",
        "recordingUrl": "https://example.com/recordings/test.mp3"
      }
    }
  }'
```

Response example:

```json
{
  "success": true,
  "delivery": {
    "event": "appointment.needed",
    "telegram": "event_not_enabled",
    "email": "event_not_enabled",
    "sms": "sent"
  }
}
```

### Real inbound call payload example

The app now also understands the real call payload shape:

```json
{
  "event": "inbound_call.completed",
  "timestamp": "2026-07-01T14:00:33.591Z",
  "data": {
    "callId": "243a9a2a-e62e-485e-80ca-cde54b07cc84",
    "conversationId": "conv_7701kwezp28rfywtdte14kev65qc",
    "callSid": "SCL_bcnqoUSz6VoL",
    "direction": "inbound",
    "status": "completed",
    "fromNumber": "+4917662410040",
    "toNumber": "493052014446",
    "phoneNumber": "+4917662410040",
    "duration": 11,
    "transcript": "AGENT (0s): Hello! how can i help you today",
    "aiSummary": "The agent greeted the caller and offered help.",
    "recordingUrl": null,
    "startedAt": "2026-07-01T14:00:22.558Z",
    "endedAt": "2026-07-01T14:00:33.558Z"
  }
}
```

For existing deployments, run `supabase-call-webhook-fix.sql` once in Supabase after deploying the code. This updates routing and templates so `inbound_call.completed` triggers email/Telegram notifications.


## Deploy to Vercel

1. Add required `.env` values to Vercel Project Settings → Environment Variables.
2. Deploy or redeploy.
3. Run `supabase.sql` in Supabase.
4. Configure global settings from the admin dashboard.
5. Set Telegram webhook if Telegram `/start` is needed.

## Optional: Translate call notifications to German

If the call provider sends `aiSummary` or `transcript` in English, enable the built-in translation layer.

In Vercel → Project → Settings → Environment Variables, add:

```env
TRANSLATE_NOTIFICATIONS_TO_DE=true
```

Then add one translation provider.

Option A — DeepL:

```env
DEEPL_API_KEY=your_deepl_api_key
# Optional. Only set this if you want to force a specific endpoint:
# DEEPL_API_URL=https://api-free.deepl.com/v2/translate
# DEEPL_API_URL=https://api.deepl.com/v2/translate
```

Option B — OpenAI:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
```

The app translates only human-readable fields like `data.aiSummary`, `data.summary`, `data.transcript`, and `message`. If translation fails or no key is configured, webhook delivery continues with the original text.

## Admin-controlled translation

The admin dashboard now has a **Translation** tab.

Recommended setup for call notifications:

- `Translation provider`: `OpenAI` or `DeepL`
- `Translate AI summary`: enabled
- `Translate transcript`: disabled unless transcripts arrive in English
- Add the matching API key in the same Translation tab

The webhook code reads these settings from `app_settings`. Environment variables still work as a fallback, but they are no longer required for translation.

For existing Supabase projects, run:

```sql
-- file: supabase-translation-settings.sql
```

Then open Admin Dashboard → Translation, choose provider, add API key, and save.
