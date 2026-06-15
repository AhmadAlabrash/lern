"use client";

import { ReactNode, useEffect, useState } from 'react';

export type WebhookUser = {
  id: string;
  email: string;
  telegram_chat_id: string | null;
  secret: string;
  notify_email?: boolean;
  notify_telegram?: boolean;
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
};

export default function UsersTable({ users, loading, refresh }: Props) {
  const [editValues, setEditValues] = useState<Record<string, EditValues>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    setEditValues((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        [field]: value,
      },
    }));
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
      const response = await fetch(`/api/admin/users/${id}/send-secret-email`, {
        method: 'POST',
      });

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
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Users</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Webhook users
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage email, Telegram chat IDs and webhook secrets.
          </p>
        </div>

        <button
          onClick={() => refresh()}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Refresh table
        </button>
      </div>

      {notice && (
        <div className="px-6 pt-5">
          <Alert type={notice.type}>{notice.text}</Alert>
        </div>
      )}

      <div className="p-4 md:p-6">
        {loading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Email</Th>
                  <Th>Telegram</Th>
                  <Th>Delivery</Th>
                  <Th>Secret</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {users.map((user) => {
                  const editing = Boolean(editValues[user.id]);
                  const values = editValues[user.id];
                  const busy = busyId === user.id;

                  return (
                    <tr key={user.id} className="align-top transition hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-sm">
                        {editing ? (
                          <input
                            type="email"
                            value={values.email}
                            onChange={(event) => updateField(user.id, 'email', event.target.value)}
                            className="w-64 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                          />
                        ) : (
                          <div>
                            <div className="font-medium text-slate-950">{user.email}</div>
                            <div className="mt-1 text-xs text-slate-400">{user.id}</div>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        {editing ? (
                          <input
                            type="text"
                            value={values.telegram_chat_id}
                            onChange={(event) =>
                              updateField(user.id, 'telegram_chat_id', event.target.value)
                            }
                            className="w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                            placeholder="chat_id"
                          />
                        ) : user.telegram_chat_id ? (
                          <Badge tone="green">{user.telegram_chat_id}</Badge>
                        ) : (
                          <Badge tone="amber">Missing</Badge>
                        )}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        {editing ? (
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                              <input
                                type="checkbox"
                                checked={values.notify_email}
                                onChange={(event) =>
                                  updateField(user.id, 'notify_email', event.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Email
                            </label>
                            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                              <input
                                type="checkbox"
                                checked={values.notify_telegram}
                                onChange={(event) =>
                                  updateField(user.id, 'notify_telegram', event.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Telegram
                            </label>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {user.notify_email !== false ? (
                              <Badge tone="blue">Email</Badge>
                            ) : (
                              <Badge tone="slate">Email off</Badge>
                            )}
                            {user.notify_telegram !== false ? (
                              <Badge tone="green">Telegram</Badge>
                            ) : (
                              <Badge tone="slate">Telegram off</Badge>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        <div className="flex max-w-xs items-center gap-2">
                          <code className="block truncate rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                            {maskSecret(user.secret)}
                          </code>
                          <button
                            onClick={() => copySecret(user.secret)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            Copy
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-4 text-sm text-slate-600">
                        {formatDate(user.created_at)}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        <div className="flex min-w-[260px] flex-wrap gap-2">
                          {editing ? (
                            <>
                              <ActionButton
                                onClick={() => saveUser(user.id)}
                                disabled={busy}
                                tone="green"
                              >
                                {busy ? 'Saving…' : 'Save'}
                              </ActionButton>
                              <ActionButton onClick={() => cancelEdit(user.id)} tone="neutral">
                                Cancel
                              </ActionButton>
                            </>
                          ) : (
                            <ActionButton onClick={() => startEdit(user)} tone="blue">
                              Edit
                            </ActionButton>
                          )}

                          <ActionButton
                            onClick={() => sendSecretEmail(user.id)}
                            disabled={busy}
                            tone="purple"
                          >
                            Email secret
                          </ActionButton>

                          <ActionButton
                            onClick={() => deleteUser(user.id)}
                            disabled={busy}
                            tone="red"
                          >
                            Delete
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'green' | 'amber' | 'blue' | 'slate' }) {
  const classes = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-500',
  }[tone];

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${classes}`}>
      {children}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: 'blue' | 'green' | 'purple' | 'red' | 'neutral';
}) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    purple: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100',
    red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes =
    type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <div className="text-4xl">👥</div>
      <h3 className="mt-4 text-lg font-semibold text-slate-950">No users yet</h3>
      <p className="mt-2 text-sm text-slate-500">
        Create your first webhook user to start receiving Telegram notifications.
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function maskSecret(secret: string) {
  if (!secret) return '';
  if (secret.length <= 16) return secret;
  return `${secret.slice(0, 8)}…${secret.slice(-8)}`;
}
