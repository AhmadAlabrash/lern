"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateUserForm from './CreateUserForm';
import UsersTable, { WebhookUser } from './UsersTable';
import SmtpSettings from './SmtpSettings';

type Tab = 'create' | 'users' | 'smtp';

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('create');
  const [users, setUsers] = useState<WebhookUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setError('');

    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setError(json.error || 'Could not load users');
        return;
      }

      setUsers(json.users || []);
    } catch {
      setError('Network error while loading users');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const stats = useMemo(() => {
    const withTelegram = users.filter((user) => Boolean(user.telegram_chat_id && user.notify_telegram !== false)).length;
    const withEmail = users.filter((user) => user.notify_email !== false).length;
    const lastCreated = users[0]?.created_at
      ? new Date(users[0].created_at).toLocaleDateString('de-DE')
      : '–';

    return {
      total: users.length,
      withTelegram,
      withEmail,
      withoutTelegram: users.length - withTelegram,
      lastCreated,
    };
  }, [users]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  const tabs: Array<{ key: Tab; label: string; description: string }> = [
    {
      key: 'create',
      label: 'Create User',
      description: 'Generate a secret and email it to a new webhook user.',
    },
    {
      key: 'users',
      label: 'Users',
      description: 'Edit delivery channels, chat IDs, secrets and users.',
    },
    {
      key: 'smtp',
      label: 'SMTP',
      description: 'Check email configuration and send a test message.',
    },
  ];

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-2xl text-white shadow">
              📞
            </div>
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
                KI-Rezeption Admin
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                Webhook Notification Center
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchUsers}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              onClick={handleLogout}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total users" value={stats.total} hint="All webhook users" />
          <StatCard label="Telegram enabled" value={stats.withTelegram} hint="chat_id + channel on" />
          <StatCard label="Email enabled" value={stats.withEmail} hint="Email channel on" />
          <StatCard label="Latest user" value={stats.lastCreated} hint="Created date" />
        </div>

        {error && (
          <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[280px,1fr]">
          <aside className="space-y-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={
                  activeTab === tab.key
                    ? 'w-full rounded-3xl border border-indigo-200 bg-indigo-600 p-5 text-left text-white shadow-lg shadow-indigo-200 transition'
                    : 'w-full rounded-3xl border border-slate-200 bg-white p-5 text-left text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50'
                }
              >
                <div className="font-semibold">{tab.label}</div>
                <div
                  className={
                    activeTab === tab.key
                      ? 'mt-1 text-sm text-indigo-100'
                      : 'mt-1 text-sm text-slate-500'
                  }
                >
                  {tab.description}
                </div>
              </button>
            ))}

            <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              <div className="font-semibold text-slate-900">Webhook endpoint</div>
              <code className="mt-3 block break-all rounded-2xl bg-slate-100 p-3 text-xs text-slate-700">
                /api/webhook
              </code>
            </div>
          </aside>

          <div>
            {activeTab === 'create' && (
              <CreateUserForm
                onSuccess={async () => {
                  await fetchUsers();
                }}
              />
            )}

            {activeTab === 'users' && (
              <UsersTable users={users} loading={loadingUsers} refresh={fetchUsers} />
            )}

            {activeTab === 'smtp' && <SmtpSettings />}
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}
