"use client";

import { ReactNode, useEffect, useState } from 'react';

export type WebhookUser = {
  id: string;
  email: string;
  telegram_chat_id: string | null;
  secret: string;
  notify_email?: boolean;
  notify_telegram?: boolean;
  notify_sms?: boolean;
  booking_url?: string | null;
  whatsapp_number?: string | null;
  sms_provider?: 'twilio' | 'future_provider' | string | null;
  plan?: 'free' | 'pro' | 'ultimate' | string | null;
  current_sms_month?: string;
  current_sms_count?: number;
  created_at: string;
  updated_at?: string;
};

interface Props {
  users: WebhookUser[];
  loading: boolean;
  refresh: () => void | Promise<void>;
}

type EditValues = {
  email: string;
  telegram_chat_id: string;
  notify_email: boolean;
  notify_telegram: boolean;
  notify_sms: boolean;
  booking_url: string;
  whatsapp_number: string;
  sms_provider: 'twilio' | 'future_provider';
  plan: 'free' | 'pro' | 'ultimate';
};

export default function UsersTable({ users, loading, refresh }: Props) {
  const [editValues, setEditValues] = useState<Record<string, EditValues>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = normalizedQuery
    ? users.filter((user) =>
        [user.email, user.telegram_chat_id, user.id, user.whatsapp_number]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      )
    : users;

  useEffect(() => {
    setEditValues({});
  }, [users.length]);

  const startEdit = (user: WebhookUser) => {
    setEditValues((previous) => ({
      ...previous,
      [user.id]: {
        email: user.email,
        telegram_chat_id: user.telegram_chat_id || '',
        notify_email: user.notify_email !== false,
        notify_telegram: user.notify_telegram !== false,
        notify_sms: user.notify_sms === true,
        booking_url: user.booking_url || '',
        whatsapp_number: user.whatsapp_number || '',
        sms_provider: user.sms_provider === 'future_provider' ? 'future_provider' : 'twilio',
        plan: user.plan === 'pro' || user.plan === 'ultimate' ? user.plan : 'free',
      },
    }));
  };

  const cancelEdit = (id: string) => {
    setEditValues((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const updateField = (id: string, field: keyof EditValues, value: string | boolean) => {
    setEditValues((previous) => ({ ...previous, [id]: { ...previous[id], [field]: value } }));
  };

  const copySecret = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    setNotice({ type: 'success', text: 'Secret copied to clipboard.' });
  };

  const saveUser = async (id: string) => {
    const values = editValues[id];
    if (!values) return;

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.email,
          telegram_chat_id: values.telegram_chat_id || null,
          notify_email: values.notify_email,
          notify_telegram: values.notify_telegram,
          notify_sms: values.notify_sms,
          booking_url: values.booking_url,
          whatsapp_number: values.whatsapp_number,
          sms_provider: values.sms_provider,
          plan: values.plan,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        setNotice({ type: 'error', text: json.error || 'Failed to save changes.' });
        return;
      }

      cancelEdit(id);
      setNotice({ type: 'success', text: 'User updated successfully.' });
      await refresh();
    } catch {
      setNotice({ type: 'error', text: 'Network error while saving user.' });
    } finally {
      setBusyId(null);
    }
  };

  const sendSecretEmail = async (id: string) => {
    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/users/${id}/send-secret-email`, { method: 'POST' });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setNotice({ type: 'error', text: json.error || 'Failed to send secret email.' });
        return;
      }

      setNotice({ type: 'success', text: 'Secret email sent successfully.' });
    } catch {
      setNotice({ type: 'error', text: 'Network error while sending email.' });
    } finally {
      setBusyId(null);
    }
  };

  const deleteUser = async (id: string) => {
    const confirmed = confirm('Delete this user permanently? This cannot be undone.');
    if (!confirmed) return;

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setNotice({ type: 'error', text: json.error || 'Failed to delete user.' });
        return;
      }

      setNotice({ type: 'success', text: 'User deleted.' });
      await refresh();
    } catch {
      setNotice({ type: 'error', text: 'Network error while deleting user.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">Users</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Webhook users</h2>
            <p className="mt-2 text-sm text-slate-500">
              Per-user settings only decide which channels are enabled. Showing {filteredUsers.length} of {users.length} users.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by email, chat_id or phone…"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100 sm:w-80"
            />
            <button
              onClick={() => refresh()}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Refresh users
            </button>
          </div>
        </div>
      </div>

      {notice && <Alert type={notice.type}>{notice.text}</Alert>}

      {loading ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-[2rem] bg-slate-200" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState />
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <div className="text-5xl">🔎</div>
          <h3 className="mt-4 text-xl font-black text-slate-950">No matching user</h3>
          <p className="mt-2 text-sm text-slate-500">Try another email, chat_id or phone number.</p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredUsers.map((user) => {
            const editing = Boolean(editValues[user.id]);
            const values = editValues[user.id];
            const busy = busyId === user.id;

            return (
              <article key={user.id} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    {editing ? (
                      <Input
                        type="email"
                        value={values.email}
                        onChange={(value) => updateField(user.id, 'email', value)}
                        placeholder="customer@example.com"
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-lg font-black text-slate-950">{user.email}</h3>
                          <PlanBadge plan={user.plan || 'free'} />
                        </div>
                        <p className="mt-1 text-xs text-slate-400">Created {formatDate(user.created_at)}</p>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge tone={user.notify_email !== false ? 'blue' : 'slate'}>{user.notify_email !== false ? 'Email' : 'Email off'}</Badge>
                    <Badge tone={user.notify_telegram !== false ? 'green' : 'slate'}>{user.notify_telegram !== false ? 'Telegram' : 'Telegram off'}</Badge>
                    <Badge tone={user.notify_sms === true ? 'purple' : 'slate'}>{user.notify_sms === true ? 'SMS' : 'SMS off'}</Badge>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <InfoBlock label="Telegram chat_id">
                    {editing ? (
                      <Input value={values.telegram_chat_id} onChange={(value) => updateField(user.id, 'telegram_chat_id', value)} placeholder="123456789" />
                    ) : (
                      user.telegram_chat_id || 'Missing'
                    )}
                  </InfoBlock>

                  <InfoBlock label="Webhook secret">
                    <div className="flex items-center gap-2">
                      <code className="truncate rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">{maskSecret(user.secret)}</code>
                      <button onClick={() => copySecret(user.secret)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        Copy
                      </button>
                    </div>
                  </InfoBlock>

                  <InfoBlock label="Booking link">
                    {editing ? (
                      <Input type="url" value={values.booking_url} onChange={(value) => updateField(user.id, 'booking_url', value)} placeholder="https://example.com/book" />
                    ) : (
                      <span className="break-all">{user.booking_url || '–'}</span>
                    )}
                  </InfoBlock>

                  <InfoBlock label="WhatsApp number">
                    {editing ? (
                      <Input value={values.whatsapp_number} onChange={(value) => updateField(user.id, 'whatsapp_number', value)} placeholder="+491701234567" />
                    ) : (
                      user.whatsapp_number || '–'
                    )}
                  </InfoBlock>

                  <InfoBlock label="SMS usage this month">
                    {user.current_sms_count || 0} sent · {user.current_sms_month || 'current month'}
                  </InfoBlock>
                </div>

                {editing && (
                  <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Toggle checked={values.notify_email} onChange={(checked) => updateField(user.id, 'notify_email', checked)}>Email notifications</Toggle>
                      <Toggle checked={values.notify_telegram} onChange={(checked) => updateField(user.id, 'notify_telegram', checked)}>Telegram notifications</Toggle>
                      <Toggle checked={values.notify_sms} onChange={(checked) => updateField(user.id, 'notify_sms', checked)}>SMS follow-up to caller</Toggle>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Plan</span>
                        <select
                          value={values.plan}
                          onChange={(event) => updateField(user.id, 'plan', event.target.value as 'free' | 'pro' | 'ultimate')}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="ultimate">Ultimate</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">SMS provider</span>
                        <select
                          value={values.sms_provider}
                          onChange={(event) => updateField(user.id, 'sms_provider', event.target.value as 'twilio' | 'future_provider')}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                        >
                          <option value="twilio">Twilio</option>
                          <option value="future_provider">Future provider</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
                  {editing ? (
                    <>
                      <ActionButton onClick={() => saveUser(user.id)} disabled={busy} tone="green">{busy ? 'Saving…' : 'Save changes'}</ActionButton>
                      <ActionButton onClick={() => cancelEdit(user.id)} tone="neutral">Cancel</ActionButton>
                    </>
                  ) : (
                    <ActionButton onClick={() => startEdit(user)} tone="blue">Edit user</ActionButton>
                  )}

                  <ActionButton onClick={() => sendSecretEmail(user.id)} disabled={busy} tone="purple">Email secret</ActionButton>
                  <ActionButton onClick={() => deleteUser(user.id)} disabled={busy} tone="red">Delete</ActionButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Input({ type = 'text', value, onChange, placeholder }: { type?: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
    />
  );
}

function InfoBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 min-h-[2rem] text-sm font-medium text-slate-800">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
      {children}
    </label>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const normalized: 'free' | 'pro' | 'ultimate' = plan === 'pro' || plan === 'ultimate' ? plan : 'free';
  const tones: Record<'free' | 'pro' | 'ultimate', string> = {
    free: 'border-slate-200 bg-slate-50 text-slate-600',
    pro: 'border-blue-200 bg-blue-50 text-blue-700',
    ultimate: 'border-violet-200 bg-violet-50 text-violet-700',
  };

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase ${tones[normalized]}`}>
      {normalized}
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'green' | 'blue' | 'slate' | 'purple' }) {
  const classes = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    purple: 'border-purple-200 bg-purple-50 text-purple-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-500',
  }[tone];

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${classes}`}>{children}</span>;
}

function ActionButton({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone: 'blue' | 'green' | 'purple' | 'red' | 'neutral' }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    purple: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100',
    red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  };

  return <button onClick={onClick} disabled={disabled} className={`rounded-xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${tones[tone]}`}>{children}</button>;
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes = type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700';
  return <div className={`rounded-3xl border px-5 py-4 text-sm ${classes}`}>{children}</div>;
}

function EmptyState() {
  return (
    <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
      <div className="text-5xl">👥</div>
      <h3 className="mt-4 text-xl font-black text-slate-950">No users yet</h3>
      <p className="mt-2 text-sm text-slate-500">Create your first webhook user to start sending notifications.</p>
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}

function maskSecret(secret: string) {
  if (!secret) return '';
  if (secret.length <= 16) return secret;
  return `${secret.slice(0, 8)}…${secret.slice(-8)}`;
}
