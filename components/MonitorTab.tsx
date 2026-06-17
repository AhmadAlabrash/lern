"use client";

import { FormEvent, ReactNode, useEffect, useState } from 'react';

type DeliveryLog = {
  id: number;
  level: string;
  channel: string | null;
  event: string | null;
  user_id: string | null;
  user_email: string | null;
  message: string;
  details?: any;
  created_at: string;
};

type MonitorSettings = {
  'monitor.alert_enabled': string;
  'monitor.alert_telegram_chat_id': string;
  'monitor.alert_email': string;
  'monitor.retention_days': string;
};

export default function MonitorTab() {
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [settings, setSettings] = useState<MonitorSettings>({
    'monitor.alert_enabled': 'false',
    'monitor.alert_telegram_chat_id': '',
    'monitor.alert_email': '',
    'monitor.retention_days': '7',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [logsResponse, settingsResponse] = await Promise.all([
        fetch('/api/admin/logs', { cache: 'no-store' }),
        fetch('/api/admin/settings', { cache: 'no-store' }),
      ]);

      const logsJson = await logsResponse.json();
      const settingsJson = await settingsResponse.json();

      if (logsJson.success) setLogs(logsJson.logs || []);
      if (settingsJson.success) {
        setSettings({
          'monitor.alert_enabled': settingsJson.settings?.['monitor.alert_enabled'] || 'false',
          'monitor.alert_telegram_chat_id': settingsJson.settings?.['monitor.alert_telegram_chat_id'] || '',
          'monitor.alert_email': settingsJson.settings?.['monitor.alert_email'] || '',
          'monitor.retention_days': settingsJson.settings?.['monitor.retention_days'] || '7',
        });
      }
    } catch {
      setNotice({ type: 'error', text: 'Could not load monitor data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setNotice({ type: 'error', text: json.error || 'Failed to save monitor settings.' });
        return;
      }

      setNotice({ type: 'success', text: 'Monitor settings saved.' });
    } catch {
      setNotice({ type: 'error', text: 'Network error while saving monitor settings.' });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm('Clear all monitor logs?')) return;

    const response = await fetch('/api/admin/logs', { method: 'DELETE' });
    const json = await response.json();

    if (!response.ok || !json.success) {
      setNotice({ type: 'error', text: json.error || 'Failed to clear logs.' });
      return;
    }

    setLogs([]);
    setNotice({ type: 'success', text: 'Logs cleared.' });
  };

  const update = (key: keyof MonitorSettings, value: string) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-600">Monitor</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Delivery errors</h2>
            <p className="mt-2 text-sm text-slate-500">
              Shows Telegram, email and SMS delivery failures. Auto-refreshes every 15 seconds and deletes old logs by retention setting.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={load} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button onClick={clear} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100">
              Clear logs
            </button>
          </div>
        </div>
      </div>

      {notice && <Alert type={notice.type}>{notice.text}</Alert>}

      <form onSubmit={saveSettings} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-4">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={settings['monitor.alert_enabled'] === 'true'}
              onChange={(event) => update('monitor.alert_enabled', event.target.checked ? 'true' : 'false')}
              className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            Send admin alerts
          </label>

          <Field label="Alert Telegram chat_id">
            <input
              value={settings['monitor.alert_telegram_chat_id']}
              onChange={(event) => update('monitor.alert_telegram_chat_id', event.target.value)}
              placeholder="123456789"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"
            />
          </Field>

          <Field label="Alert email">
            <input
              type="email"
              value={settings['monitor.alert_email']}
              onChange={(event) => update('monitor.alert_email', event.target.value)}
              placeholder="admin@example.com"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"
            />
          </Field>

          <Field label="Retention days">
            <input
              type="number"
              min="1"
              value={settings['monitor.retention_days']}
              onChange={(event) => update('monitor.retention_days', event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"
            />
          </Field>
        </div>

        <button disabled={saving} className="mt-5 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save monitor settings'}
        </button>
      </form>

      <div className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        {logs.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="text-5xl">✅</div>
            <h3 className="mt-4 text-xl font-black text-slate-950">No delivery errors</h3>
            <p className="mt-2 text-sm text-slate-500">Everything looks good.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((log) => (
              <div key={log.id} className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{log.channel || 'unknown'}</Badge>
                      <span className="text-sm font-bold text-slate-950">{log.message}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      Event: {log.event || '–'} · User: {log.user_email || log.user_id || '–'}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-400">{formatDate(log.created_at)}</div>
                </div>

                {log.details && (
                  <pre className="mt-4 max-h-44 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-black uppercase text-red-700">{children}</span>;
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes = type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700';
  return <div className={`rounded-3xl border px-5 py-4 text-sm ${classes}`}>{children}</div>;
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}
