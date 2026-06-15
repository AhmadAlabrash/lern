# KI-Rezeption Admin Dashboard

This project is a simple but production‑ready admin dashboard built with **Next.js**, **TypeScript**, **Tailwind CSS**, **Supabase**, **Nodemailer** and the **Telegram Bot API**. It allows you to create webhook users whose secrets can be used to authenticate incoming webhook requests. When a webhook is received, the payload is transformed into a professional German message and sent to a configured Telegram chat.

## Features

* **Secure admin panel** – protected by a login using credentials from your `.env` file. Sessions are stored in an HTTP‑only cookie signed with `SESSION_SECRET`.
* **Create webhook users** – generate strong random secrets and store them along with an email address and optional Telegram chat‑ID in Supabase.
* **User management** – list all users, edit their details, choose notification channels, resend their secret by email or delete them.
* **Webhook endpoint** – authenticate requests using the Bearer secret token, look up the user in Supabase, transform the payload into a German message and send it to the enabled channels: Telegram, email, or both.
* **Email notifications** – when a user is created or when requested from the dashboard, their secret token is emailed using Nodemailer.
* **Responsive UI** – built with Tailwind CSS and the Next.js App Router.

## Prerequisites

* Node.js ≥ 18
* A Supabase project (free tier is sufficient)
* SMTP credentials for sending emails (e.g. from an email provider)
* A Telegram bot token and the chat ID of the recipient

## Setup

1. **Clone the repository and install dependencies**

   ```bash
   git clone <this‑repo>.git
   cd ki-rezeption-dashboard
   npm install
   ```

2. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in all values:

   ```ini
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=supersecurepassword

   NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-smtp-user
   SMTP_PASS=your-smtp-pass
   SMTP_FROM=“KI-Rezeption <no-reply@example.com>”

   TELEGRAM_BOT_TOKEN=123456:ABCDEF...

   APP_BASE_URL=http://localhost:3000

   SESSION_SECRET=a-very-long-random-string
   ```

   **Do not commit your real `.env` file to version control.**

3. **Create the Supabase table**

   Execute the SQL file `supabase.sql` in your Supabase dashboard (SQL editor) to create the `webhook_users` table and its trigger:

   ```sql
   -- run in Supabase SQL editor
   -- contents of supabase.sql
   ```

4. **Run the development server**

   ```bash
   npm run dev
   ```

   Visit <http://localhost:3000/admin/login> to log in. Use the credentials from your `.env` file.

5. **Deploying**

   When deploying, make sure the environment variables are set in your hosting provider. The `SUPABASE_SERVICE_ROLE_KEY`, SMTP credentials and `TELEGRAM_BOT_TOKEN` must **never** be exposed to the client.


## Notification channels

Each `webhook_users` row has two delivery options:

- `notify_email`
- `notify_telegram`

When a webhook event arrives at `/api/webhook`, the app validates the Bearer token, formats the event into a German message, and sends it through the channels enabled for that user.

Existing installations should run the updated `supabase.sql` file or at least this upgrade SQL:

```sql
alter table if exists public.webhook_users
  add column if not exists notify_email boolean not null default true;

alter table if exists public.webhook_users
  add column if not exists notify_telegram boolean not null default true;
```

## SMTP settings in admin

The admin dashboard includes an SMTP tab where you can view the current SMTP configuration status and send a test email.

On Vercel, SMTP environment variables should be edited in:

```text
Vercel Project → Settings → Environment Variables
```

Then redeploy the app. Runtime editing of `.env` from the app is intentionally not implemented because serverless deployments do not persist `.env` changes safely.

## Example webhook request

Send a webhook to the API using your generated user secret. Replace `USER_SECRET_HERE` with an actual secret and `APP_BASE_URL` with your deployment URL:

```bash
curl -X POST "$APP_BASE_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_SECRET_HERE" \
  -d '{
    "event": "webhook.test",
    "timestamp": "2026-06-15T12:20:50.115Z",
    "data": {
      "contact": {
        "name": "Test User",
        "phone": "+15555551234",
        "email": "test@example.com",
        "company": "Test Company Inc."
      },
      "call": {
        "status": "completed",
        "durationMinutes": 2,
        "classification": "Warm Lead",
        "sentiment": "positive",
        "summary": "Test call completed successfully with positive outcome.",
        "recordingUrl": "https://example.com/recordings/test.mp3"
      }
    }
  }'
```

If the secret matches a user, the server responds with a JSON object indicating success and sends a message to the specified Telegram chat.

## File structure overview

| Path | Purpose |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `app/api/admin/` | Admin API endpoints for login, logout and managing users |
| `app/api/webhook/` | Public webhook endpoint |
| `components/` | Reusable React components such as the admin dashboard |
| `lib/` | Helper functions (Supabase client, mailer, Telegram helper, message formatter) |
| `supabase.sql` | SQL migration to create the `webhook_users` table |
| `.env.example` | Template for required environment variables |

## Security considerations

* The `SUPABASE_SERVICE_ROLE_KEY`, SMTP credentials and `TELEGRAM_BOT_TOKEN` are only used server‑side and must never be exposed to the client. Ensure they are **not** prefixed with `NEXT_PUBLIC_`.
* The admin session is stored in an HTTP‑only cookie and signed with `SESSION_SECRET`. Adjust the `maxAge` in `lib/auth.ts` if you require shorter or longer sessions.
* Validate all incoming requests in your API routes using schemas from `zod` or your preferred validation library. This example uses simple checks for brevity but demonstrates where to add validation.

## Extending the project

This project is intentionally kept simple so you can adapt it to your own needs. You can enhance it by:

* Adding user roles and permissions
* Integrating OAuth or Supabase Auth for admin authentication
* Adding pagination and searching to the user table
* Customising the email template and Telegram formatting

Feel free to build on top of this starting point!


## Telegram bot chat_id flow

This project includes a Telegram webhook endpoint:

```text
POST /api/telegram/webhook
```

When a user opens your Telegram bot and presses **Start**, the bot replies with their Telegram `chat_id`. The user can send that `chat_id` to you, and you can save it in the admin dashboard when creating or editing a webhook user.

Add this variable to your `.env`:

```ini
TELEGRAM_WEBHOOK_SECRET=a-long-random-secret
```

### Set the Telegram webhook

Telegram webhooks require a public HTTPS URL. For production, use your real app URL. For local testing, use a tunnel like ngrok:

```bash
ngrok http 3000
```

Then set the webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$APP_BASE_URL/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

PowerShell example:

```powershell
$botToken="YOUR_TELEGRAM_BOT_TOKEN"
$appUrl="https://your-domain.com"
$secret="YOUR_TELEGRAM_WEBHOOK_SECRET"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Body @{
    url="$appUrl/api/telegram/webhook"
    secret_token="$secret"
  }
```

After this, send `/start` to your bot and it will reply with the chat ID.

## Troubleshooting

If `npm install` reports `ENOENT: no such file or directory, open ... package.json`, make sure you are inside the extracted project folder that contains `package.json`:

```bash
cd ki-rezeption-dashboard
dir package.json   # Windows PowerShell
npm install
npm run dev
```

If you extracted a nested zip folder, the correct folder is the one where `app/`, `components/`, `lib/`, `package.json`, and `README.md` are all visible together.
