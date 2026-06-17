"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateUserForm from './CreateUserForm';
import UsersTable, { WebhookUser } from './UsersTable';
import SmtpSettings from './SmtpSettings';
import GlobalSettings from './GlobalSettings';
import MonitorTab from './MonitorTab';

type Tab = 'create' | 'users' | 'settings' | 'monitor' | 'smtp';

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [users, setUsers] = useState<WebhookUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

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
    const savedTheme = window.localStorage.getItem('dashboard_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('dashboard_theme', next);
      return next;
    });
  };

  const stats = useMemo(() => {
    const withTelegram = users.filter((user) => Boolean(user.telegram_chat_id && user.notify_telegram !== false)).length;
    const withEmail = users.filter((user) => user.notify_email !== false).length;
    const withSms = users.filter((user) => user.notify_sms === true).length;

    return { total: users.length, withTelegram, withEmail, withSms };
  }, [users]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  const tabs: Array<{ key: Tab; label: string; description: string }> = [
    { key: 'users', label: 'Users', description: 'Customers, secrets and channels' },
    { key: 'create', label: 'Create User', description: 'Generate a new webhook secret' },
    { key: 'settings', label: 'Routing & API', description: 'Global events, templates and credentials' },
    { key: 'monitor', label: 'Monitor', description: 'Delivery errors and alerts' },
    { key: 'smtp', label: 'SMTP Test', description: 'Check email sending' },
  ];

  return (
    <main className={`min-h-screen bg-[#f3f5f9] text-slate-950 ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-xl text-white shadow-lg shadow-slate-950/15">
                📞
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">KI-Rezeption Admin</p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Webhook Notification Center</h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
              <button
                onClick={fetchUsers}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Refresh
              </button>
              <button
                onClick={handleLogout}
                className="rounded-2xl bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-violet-500"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total users" value={stats.total} hint="All webhook users" />
          <StatCard label="Telegram" value={stats.withTelegram} hint="Enabled users" />
          <StatCard label="Email" value={stats.withEmail} hint="Enabled users" />
          <StatCard label="SMS" value={stats.withSms} hint="Enabled users" />
        </div>

        {error && <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}

        <nav className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid gap-2 lg:grid-cols-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={
                  activeTab === tab.key
                    ? 'rounded-3xl bg-slate-950 p-4 text-left text-white shadow-lg shadow-slate-950/15'
                    : 'rounded-3xl p-4 text-left text-slate-700 transition hover:bg-slate-100'
                }
              >
                <div className="font-black">{tab.label}</div>
                <div className={activeTab === tab.key ? 'mt-1 text-xs text-slate-300' : 'mt-1 text-xs text-slate-500'}>{tab.description}</div>
              </button>
            ))}
          </div>
        </nav>

        <div className="mt-8">
          {activeTab === 'users' && <UsersTable users={users} loading={loadingUsers} refresh={fetchUsers} />}
          {activeTab === 'create' && <CreateUserForm onSuccess={fetchUsers} />}
          {activeTab === 'settings' && <GlobalSettings />}
          {activeTab === 'monitor' && <MonitorTab />}
          {activeTab === 'smtp' && <SmtpSettings />}
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}
