"use client";

import { ReactNode, useEffect, useMemo, useState } from 'react';

type SettingsMap = Record<string, string>;

type Section = 'routing' | 'templates' | 'plans' | 'credentials';

const routingFields = [
  {
    key: 'routing.telegram_events',
    label: 'Telegram events',
    description: 'Telegram sends only for these event names. One event per line. Use * for all events.',
    placeholder: 'webhook.test\ninbound_call.completed\ninbound_call.failed\ninbound_call.missed\nappointment.needed\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  },
  {
    key: 'routing.email_events',
    label: 'Email events',
    description: 'Email sends only for these event names. One event per line. Use * for all events.',
    placeholder: 'webhook.test\ninbound_call.completed\ninbound_call.failed\ninbound_call.missed\nappointment.needed\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  },
  {
    key: 'routing.sms_events',
    label: 'SMS events',
    description: 'SMS goes to the caller number and should usually be limited to appointment-needed events.',
    placeholder: 'appointment.needed',
  },
];

const templateFields = [
  {
    key: 'template.telegram',
    label: 'Telegram event message template',
    rows: 16,
  },
  {
    key: 'template.email',
    label: 'Email event message template',
    rows: 16,
  },
  {
    key: 'template.sms',
    label: 'SMS follow-up template',
    rows: 5,
  },
  {
    key: 'template.secret_email_text',
    label: 'Secret email body template',
    rows: 14,
  },
];

const credentialGroups = [
  {
    title: 'SMTP',
    description: 'Used for secret emails and webhook email notifications.',
    fields: [
      ['smtp.host', 'SMTP host', 'smtp.example.com', 'text'],
      ['smtp.port', 'SMTP port', '587', 'text'],
      ['smtp.secure', 'SMTP secure', 'false', 'text'],
      ['smtp.user', 'SMTP user', 'user@example.com', 'text'],
      ['smtp.pass', 'SMTP password', '••••••••', 'password'],
      ['smtp.from', 'SMTP from', 'KI-Rezeption <no-reply@example.com>', 'text'],
    ],
  },
  {
    title: 'Telegram',
    description: 'Used for bot messages and the /start chat_id flow.',
    fields: [['telegram.bot_token', 'Bot token', '123456:ABC...', 'password']],
  },
  {
    title: 'Twilio SMS',
    description: 'Used when SMS provider is Twilio.',
    fields: [
      ['twilio.account_sid', 'Account SID', 'AC...', 'password'],
      ['twilio.auth_token', 'Auth token', '••••••••', 'password'],
      ['twilio.messaging_service_sid', 'Messaging Service SID', 'MG...', 'text'],
      ['sms.default_provider', 'Default SMS provider', 'twilio', 'text'],
    ],
  },
];

const placeholders = [
  '{event}',
  '{direction}',
  '{status}',
  '{duration}',
  '{duration_seconds}',
  '{duration_minutes}',
  '{contact_name}',
  '{contact_phone}',
  '{contact_email}',
  '{company}',
  '{address}',
  '{from_number}',
  '{to_number}',
  '{phone_number}',
  '{summary}',
  '{ai_summary}',
  '{transcript}',
  '{recording_url}',
  '{timestamp}',
  '{started_at}',
  '{ended_at}',
  '{call_id}',
  '{conversation_id}',
  '{call_sid}',
  '{agent_id}',
  '{classification}',
  '{sentiment}',
  '{booking_url}',
  '{whatsapp_link}',
  '{whatsapp_number}',
  '{secret}',
  '{webhook_endpoint}',
  '{app_base_url}',
  '{email}',
];

export default function GlobalSettings() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('routing');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setNotice({ type: 'error', text: json.error || 'Could not load settings.' });
        return;
      }

      setSettings(json.settings || {});
    } catch {
      setNotice({ type: 'error', text: 'Network error while loading settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const update = (key: string, value: string) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const save = async () => {
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
        setNotice({ type: 'error', text: json.error || 'Could not save settings.' });
        return;
      }

      setNotice({ type: 'success', text: 'Global settings saved. New webhooks will use these values immediately.' });
    } catch {
      setNotice({ type: 'error', text: 'Network error while saving settings.' });
    } finally {
      setSaving(false);
    }
  };

  const eventsCount = useMemo(() => {
    const count = (key: string) => (settings[key] || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).length;
    return {
      telegram: count('routing.telegram_events'),
      email: count('routing.email_events'),
      sms: count('routing.sms_events'),
    };
  }, [settings]);

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">Global control</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Routing, templates & API settings</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              These settings are centralized. Change them once here and all webhook users follow the same event routing and message templates.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || loading}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save global settings'}
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Telegram route events" value={eventsCount.telegram} />
          <MiniStat label="Email route events" value={eventsCount.email} />
          <MiniStat label="SMS route events" value={eventsCount.sms} />
        </div>
      </div>

      {notice && <Alert type={notice.type}>{notice.text}</Alert>}

      <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-4">
          <SectionButton active={activeSection === 'routing'} onClick={() => setActiveSection('routing')} title="Event Routing" description="Which events trigger each channel" />
          <SectionButton active={activeSection === 'templates'} onClick={() => setActiveSection('templates')} title="Messages" description="Telegram, email and SMS content" />
          <SectionButton active={activeSection === 'plans'} onClick={() => setActiveSection('plans')} title="Plans" description="Monthly SMS limits" />
          <SectionButton active={activeSection === 'credentials'} onClick={() => setActiveSection('credentials')} title="API Credentials" description="SMTP, Telegram and Twilio" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-3xl bg-slate-200" />
          ))}
        </div>
      ) : (
        <>
          {activeSection === 'routing' && (
            <div className="grid gap-5 lg:grid-cols-3">
              {routingFields.map((field) => (
                <Card key={field.key}>
                  <Label title={field.label} description={field.description} />
                  <textarea
                    value={settings[field.key] || ''}
                    onChange={(event) => update(field.key, event.target.value)}
                    rows={10}
                    placeholder={field.placeholder}
                    className="mt-4 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                  />
                </Card>
              ))}
            </div>
          )}

          {activeSection === 'templates' && (
            <div className="grid gap-5 xl:grid-cols-[1fr,320px]">
              <div className="space-y-5">
                <Card>
                  <Label title="Secret email subject" description="Subject line for the email that sends the generated webhook secret." />
                  <input
                    value={settings['template.secret_email_subject'] || ''}
                    onChange={(event) => update('template.secret_email_subject', event.target.value)}
                    className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                    placeholder="Ihr Webhook-Zugang für KI-Rezeption"
                  />
                </Card>

                {templateFields.map((field) => (
                  <Card key={field.key}>
                    <Label title={field.label} description="Edit this template once and it will apply to all users." />
                    <textarea
                      value={settings[field.key] || ''}
                      onChange={(event) => update(field.key, event.target.value)}
                      rows={field.rows}
                      className="mt-4 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-6 text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                    />
                  </Card>
                ))}
              </div>

              <Card>
                <Label title="Available placeholders" description="Use these tokens inside templates. Empty values are automatically cleaned." />
                <div className="mt-4 flex flex-wrap gap-2">
                  {placeholders.map((placeholder) => (
                    <button
                      key={placeholder}
                      type="button"
                      onClick={() => navigator.clipboard.writeText(placeholder)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {placeholder}
                    </button>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {activeSection === 'plans' && (
            <div className="grid gap-5 lg:grid-cols-3">
              <PlanLimitCard
                title="Free"
                settingKey="plan.free_sms_limit"
                value={settings['plan.free_sms_limit'] || '0'}
                onChange={(value) => update('plan.free_sms_limit', value)}
              />
              <PlanLimitCard
                title="Pro"
                settingKey="plan.pro_sms_limit"
                value={settings['plan.pro_sms_limit'] || '200'}
                onChange={(value) => update('plan.pro_sms_limit', value)}
              />
              <PlanLimitCard
                title="Ultimate"
                settingKey="plan.ultimate_sms_limit"
                value={settings['plan.ultimate_sms_limit'] || '500'}
                onChange={(value) => update('plan.ultimate_sms_limit', value)}
              />
            </div>
          )}

          {activeSection === 'credentials' && (
            <div className="grid gap-5 lg:grid-cols-3">
              {credentialGroups.map((group) => (
                <Card key={group.title}>
                  <Label title={group.title} description={group.description} />
                  <div className="mt-4 space-y-4">
                    {group.fields.map(([key, label, placeholder, type]) => (
                      <label key={key} className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                        <input
                          type={type}
                          value={settings[key] || ''}
                          onChange={(event) => update(key, event.target.value)}
                          placeholder={placeholder}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                        />
                      </label>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlanLimitCard({
  title,
  settingKey,
  value,
  onChange,
}: {
  title: string;
  settingKey: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Card>
      <Label
        title={`${title} plan`}
        description={`Monthly SMS limit for ${title} users. Set 0 to block SMS for this plan.`}
      />
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-3xl font-black text-slate-950 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
      />
      <code className="mt-4 block rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-500">
        {settingKey}
      </code>
    </Card>
  );
}

function SectionButton({ active, onClick, title, description }: { active: boolean; onClick: () => void; title: string; description: string }) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'rounded-3xl bg-slate-950 p-5 text-left text-white shadow-lg shadow-slate-950/20'
          : 'rounded-3xl p-5 text-left text-slate-800 transition hover:bg-slate-100'
      }
    >
      <div className="font-bold">{title}</div>
      <div className={active ? 'mt-1 text-sm text-slate-300' : 'mt-1 text-sm text-slate-500'}>{description}</div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{label}</div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">{children}</div>;
}

function Label({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-lg font-black tracking-tight text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function Alert({ type, children }: { type: 'success' | 'error'; children: ReactNode }) {
  const classes =
    type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';

  return <div className={`rounded-3xl border px-5 py-4 text-sm ${classes}`}>{children}</div>;
}
