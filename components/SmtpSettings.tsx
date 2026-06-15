"use client";

import { FormEvent, ReactNode, useEffect, useState } from 'react';

type SmtpStatus = {
  configured: boolean;
  host: string;
  port: string;
  secure: string;
  user: string;
  from: string;
};

export default function SmtpSettings() {
  const [smtp, setSmtp] = useState<SmtpStatus | null>(null);
  const [note, setNote] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/smtp', { cache: 'no-store' });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setMessage({ type: 'error', text: json.error || 'Could not load SMTP settings.' });
        return;
      }

      setSmtp(json.smtp);
      setNote(json.note || '');
    } catch {
      setMessage({ type: 'error', text: 'Network error while loading SMTP settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const sendTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTesting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        setMessage({ type: 'error', text: json.error || 'Failed to send test email.' });
        return;
      }

      setMessage({ type: 'success', text: 'SMTP test email sent successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Network error while sending test email.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
          SMTP Settings
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
          Email delivery configuration
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          View current SMTP status and send a test email.
        </p>
      </div>

      <div className="space-y-6 px-6 py-6">
        {message && <Alert type={message.type}>{message.text}</Alert>}

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <div className="font-semibold">Important for Vercel</div>
          <p className="mt-2 leading-6">
            Environment variables cannot be safely edited from the app at runtime on Vercel.
            To change SMTP credentials, update them in Vercel Project Settings → Environment
            Variables and then redeploy the project.
          </p>
        </div>

        {loading ? (
          <div className="h-44 animate-pulse rounded-3xl bg-slate-100" />
        ) : smtp ? (
          <div className="grid gap-4 md:grid-cols-2">
            <StatusCard label="SMTP status" value={smtp.configured ? 'Configured' : 'Missing'} tone={smtp.configured ? 'green' : 'red'} />
            <StatusCard label="Host" value={smtp.host || 'Not set'} />
            <StatusCard label="Port" value={smtp.port || 'Not set'} />
            <StatusCard label="Secure" value={smtp.secure || 'Not set'} />
            <StatusCard label="User" value={smtp.user || 'Not set'} />
            <StatusCard label="From" value={smtp.from || 'Not set'} />
          </div>
        ) : null}

        {note && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            {note}
          </div>
        )}

        <form onSubmit={sendTest} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <label className="block">
            <span className="text-sm font-semibold text-slate-900">Send SMTP test email</span>
            <span className="mt-1 block text-xs text-slate-500">
              Use this to verify your SMTP credentials after changing them.
            </span>
            <input
              type="email"
              required
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              placeholder="you@example.com"
            />
          </label>

          <button
            type="submit"
            disabled={testing}
            className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {testing ? 'Sending test…' : 'Send test email'}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'red';
}) {
  const valueClasses = {
    neutral: 'text-slate-950',
    green: 'text-emerald-700',
    red: 'text-red-700',
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`mt-2 break-all text-lg font-bold ${valueClasses[tone]}`}>{value}</div>
    </div>
  );
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes =
    type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}
