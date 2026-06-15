"use client";

import { FormEvent, ReactNode, useState } from 'react';

interface Props {
  onSuccess?: () => void | Promise<void>;
}

export default function CreateUserForm({ onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [createdUser, setCreatedUser] = useState<any>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setCreatedUser(null);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          telegram_chat_id: telegramChatId,
          notify_email: notifyEmail,
          notify_telegram: notifyTelegram,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        setMessage({ type: 'error', text: json.error || 'Failed to create user' });
        return;
      }

      setCreatedUser(json.user);
      setEmail('');
      setTelegramChatId('');
      setNotifyEmail(true);
      setNotifyTelegram(true);
      setMessage({
        type: 'success',
        text: 'User created. The secret was generated and the email was sent.',
      });

      await onSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    if (!createdUser?.secret) return;

    await navigator.clipboard.writeText(createdUser.secret);
    setMessage({ type: 'success', text: 'Secret copied to clipboard.' });
  };

  const resendEmail = async () => {
    if (!createdUser?.id) return;

    setResendLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/${createdUser.id}/send-secret-email`, {
        method: 'POST',
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        setMessage({ type: 'error', text: json.error || 'Failed to send email' });
        return;
      }

      setMessage({ type: 'success', text: 'Secret email sent again.' });
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
          Create User
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
          Generate a webhook secret
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Create a user, email the secret automatically and optionally connect their Telegram chat.
        </p>
      </div>

      <form className="space-y-5 px-6 py-6" onSubmit={handleSubmit}>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="User email"
            description="The secret will be sent to this email address."
          >
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              placeholder="customer@example.com"
            />
          </Field>

          <Field
            label="Telegram chat_id"
            description="Optional. The user can get it by pressing /start in your bot."
          >
            <input
              type="text"
              value={telegramChatId}
              onChange={(event) => setTelegramChatId(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              placeholder="123456789"
            />
          </Field>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <div className="text-sm font-semibold text-slate-900">Delivery preferences</div>
          <p className="mt-1 text-xs text-slate-500">
            Choose which channels should receive incoming webhook event notifications.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ToggleCard
              checked={notifyEmail}
              onChange={setNotifyEmail}
              title="Email notifications"
              description="Send the German event message to the user's email address."
            />
            <ToggleCard
              checked={notifyTelegram}
              onChange={setNotifyTelegram}
              title="Telegram notifications"
              description="Send the German event message to the configured Telegram chat_id."
            />
          </div>
        </div>

        {message && <Alert type={message.type}>{message.text}</Alert>}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-100 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Creating user…' : 'Create user and send email'}
          </button>
          <p className="text-xs text-slate-500">
            Secrets are generated server-side using strong random bytes.
          </p>
        </div>
      </form>

      {createdUser && (
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-6">
          <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-700">Latest generated secret</p>
                <p className="mt-1 text-sm text-slate-500">
                  Save or send this token to the user. It is also stored in Supabase.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={copySecret}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Copy secret
                </button>
                <button
                  onClick={resendEmail}
                  disabled={resendLoading}
                  className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {resendLoading ? 'Sending…' : 'Send email again'}
                </button>
              </div>
            </div>

            <code className="mt-4 block break-all rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {createdUser.secret}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
      <span className="mt-3 block">{children}</span>
    </label>
  );
}

function ToggleCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={
        checked
          ? 'flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm'
          : 'flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
    </label>
  );
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes =
    type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}
