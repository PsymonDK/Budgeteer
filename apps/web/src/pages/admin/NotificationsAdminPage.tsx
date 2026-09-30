import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useUserMe } from '../../api/queries'
import type { NotificationDeliveryRow, SmtpSecurity, SystemNotificationSettings } from '../../api/types'
import { Page } from '../../components/Page'
import { PageHeader } from '../../components/PageHeader'
import { StickyActions } from '../../components/StickyActions'
import { FormError } from '../../components/FormError'
import { ChannelToggle } from '../../components/notifications/ChannelToggle'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'

const cardClass = 'bg-gray-900 border border-gray-800 rounded-xl p-6'
const DEFAULT_PORT: Record<SmtpSecurity, number> = { NONE: 25, STARTTLS: 587, TLS: 465 }
const SECURITY_OPTIONS: { value: SmtpSecurity; label: string }[] = [
  { value: 'STARTTLS', label: 'STARTTLS (usually port 587)' },
  { value: 'TLS', label: 'TLS (usually port 465)' },
  { value: 'NONE', label: 'None (local relay only)' },
]

interface FormState {
  inAppEnabled: boolean
  emailEnabled: boolean
  webhookEnabled: boolean
  webhookAllowPrivateNetwork: boolean
  smtpHost: string
  smtpPort: string
  smtpSecurity: SmtpSecurity
  smtpUsername: string
  /** '' keeps the saved password */
  smtpPassword: string
  /** Remove the saved password on save */
  clearPassword: boolean
  smtpFromAddress: string
  smtpFromName: string
}

const toForm = (s: SystemNotificationSettings): FormState => ({
  inAppEnabled: s.inAppEnabled,
  emailEnabled: s.emailEnabled,
  webhookEnabled: s.webhookEnabled,
  webhookAllowPrivateNetwork: s.webhookAllowPrivateNetwork,
  smtpHost: s.smtp.host ?? '',
  smtpPort: s.smtp.port?.toString() ?? '',
  smtpSecurity: s.smtp.security,
  smtpUsername: s.smtp.username ?? '',
  smtpPassword: '',
  clearPassword: false,
  smtpFromAddress: s.smtp.fromAddress ?? '',
  smtpFromName: s.smtp.fromName ?? '',
})

function apiError(err: unknown, fallback: string) {
  const body = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: { fieldErrors?: Record<string, string[]> } }) : undefined
  return Object.values(body?.details?.fieldErrors ?? {})[0]?.[0] ?? body?.error ?? fallback
}

/** Which reminder channels this install offers, its email server, and the recent delivery log. */
export function NotificationsAdminPage() {
  const queryClient = useQueryClient()
  const { data: me } = useUserMe()
  const { data: saved } = useQuery({
    queryKey: qk.adminNotificationSettings(),
    queryFn: async () => (await api.get<SystemNotificationSettings>('/admin/notification-settings')).data,
  })
  const { data: deliveries = [] } = useQuery({
    queryKey: qk.adminNotificationDeliveries(),
    queryFn: async () => (await api.get<NotificationDeliveryRow[]>('/admin/notification-deliveries', { params: { limit: 50 } })).data,
  })

  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [testTo, setTestTo] = useState('')
  useEffect(() => { if (saved) setForm(toForm(saved)) }, [saved])
  useEffect(() => { if (me?.email) setTestTo((t) => t || me.email) }, [me?.email])

  const saveMutation = useMutation({
    mutationFn: (f: FormState) => api.put<SystemNotificationSettings>('/admin/notification-settings', {
      inAppEnabled: f.inAppEnabled,
      emailEnabled: f.emailEnabled,
      webhookEnabled: f.webhookEnabled,
      webhookAllowPrivateNetwork: f.webhookAllowPrivateNetwork,
      smtpHost: f.smtpHost,
      smtpPort: f.smtpPort ? Number(f.smtpPort) : null,
      smtpSecurity: f.smtpSecurity,
      smtpUsername: f.smtpUsername,
      smtpFromAddress: f.smtpFromAddress,
      smtpFromName: f.smtpFromName,
      ...(f.clearPassword ? { smtpPassword: null } : f.smtpPassword ? { smtpPassword: f.smtpPassword } : {}),
    }),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(qk.adminNotificationSettings(), data)
      // What households and members may turn on changes with it
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] })
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
      setError('')
      toast.success('Notification settings saved')
    },
    onError: (err) => setError(apiError(err, 'Failed to save notification settings')),
  })

  const testMutation = useMutation({
    mutationFn: (to: string) => api.post('/admin/notification-settings/test-email', { to }),
    onSuccess: (_d, to) => toast.success(`Test email sent to ${to}`),
    onError: (err) => toast.error(apiError(err, 'The test email could not be sent')),
  })

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(toForm(saved))
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const smtpReady = !!saved?.smtp.host && !!saved?.smtp.fromAddress

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form) saveMutation.mutate(form)
  }

  return (
    <Page template="form">
      <PageHeader
        title="Notifications"
        subtitle="Payment reminders for what households pay by hand. Households and members can turn channels off for themselves, but not on when they're off here."
      />

      {form && saved && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className={`${cardClass} space-y-5`} aria-labelledby="channels-heading">
            <h2 id="channels-heading" className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Channels on this install</h2>
            <ChannelToggle
              id="sys-in-app"
              label="In the app"
              description="A count on the Dashboard link and a summary on the to-pay list."
              checked={form.inAppEnabled}
              onChange={(inAppEnabled) => set({ inAppEnabled })}
            />
            <ChannelToggle
              id="sys-email"
              label="Email"
              description="A daily digest by email, through the email server below."
              checked={form.emailEnabled}
              onChange={(emailEnabled) => set({ emailEnabled })}
            />
            <div className="space-y-3">
              <ChannelToggle
                id="sys-webhook"
                label="ntfy and webhooks"
                description="A daily digest posted to an ntfy topic or a webhook URL (Gotify, Home Assistant, Discord…)."
                checked={form.webhookEnabled}
                onChange={(webhookEnabled) => set({ webhookEnabled })}
              />
              <div className="pl-7">
                <ChannelToggle
                  id="sys-webhook-private"
                  label="Allow private-network addresses"
                  description="Lets webhooks reach addresses on your own network, e.g. an ntfy server at 192.168.1.10. Leave off unless you need it."
                  checked={form.webhookAllowPrivateNetwork}
                  onChange={(webhookAllowPrivateNetwork) => set({ webhookAllowPrivateNetwork })}
                  allowed={form.webhookEnabled}
                  blockedNote="Only applies when ntfy and webhooks are on."
                />
              </div>
            </div>
          </section>

          <section className={`${cardClass} space-y-4`} aria-labelledby="smtp-heading">
            <div>
              <h2 id="smtp-heading" className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Email server</h2>
              <p className="text-xs text-gray-500 mt-1">The SMTP server reminder emails are sent through, e.g. your mail provider's.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div>
                <label htmlFor="smtp-host" className="block text-xs font-medium text-gray-400 mb-1">Server</label>
                <input id="smtp-host" value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.example.com" autoComplete="off" className={inputClass} />
              </div>
              <div>
                <label htmlFor="smtp-port" className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                <input
                  id="smtp-port" type="number" inputMode="numeric" min={1} max={65535}
                  value={form.smtpPort} onChange={(e) => set({ smtpPort: e.target.value })}
                  placeholder={String(DEFAULT_PORT[form.smtpSecurity])} className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="smtp-security" className="block text-xs font-medium text-gray-400 mb-1">Security</label>
              <select id="smtp-security" value={form.smtpSecurity} onChange={(e) => set({ smtpSecurity: e.target.value as SmtpSecurity })} className={inputClass}>
                {SECURITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="smtp-username" className="block text-xs font-medium text-gray-400 mb-1">Username <span className="text-gray-600">(optional)</span></label>
                <input id="smtp-username" value={form.smtpUsername} onChange={(e) => set({ smtpUsername: e.target.value })} autoComplete="off" className={inputClass} />
              </div>
              <div>
                <label htmlFor="smtp-password" className="block text-xs font-medium text-gray-400 mb-1">Password</label>
                <input
                  id="smtp-password" type="password" autoComplete="new-password"
                  value={form.smtpPassword}
                  onChange={(e) => set({ smtpPassword: e.target.value, clearPassword: false })}
                  placeholder={saved.smtp.passwordSet && !form.clearPassword ? 'Saved — type to replace' : ''}
                  aria-describedby="smtp-password-help"
                  className={inputClass}
                />
                <p id="smtp-password-help" className="text-xs text-gray-500 mt-1">
                  Stored encrypted and never shown again.
                  {saved.smtp.passwordSet && !form.clearPassword && (
                    <> <button type="button" onClick={() => set({ clearPassword: true, smtpPassword: '' })} className="text-amber-400 hover:text-amber-300">Remove it</button></>
                  )}
                  {form.clearPassword && <> It will be removed when you save.</>}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="smtp-from" className="block text-xs font-medium text-gray-400 mb-1">Send from</label>
                <input id="smtp-from" type="email" value={form.smtpFromAddress} onChange={(e) => set({ smtpFromAddress: e.target.value })} placeholder="budget@example.com" className={inputClass} />
              </div>
              <div>
                <label htmlFor="smtp-from-name" className="block text-xs font-medium text-gray-400 mb-1">Sender name <span className="text-gray-600">(optional)</span></label>
                <input id="smtp-from-name" value={form.smtpFromName} onChange={(e) => set({ smtpFromName: e.target.value })} placeholder="Budgeteer" className={inputClass} />
              </div>
            </div>

            <div className="border-t border-gray-800 pt-4">
              <label htmlFor="smtp-test-to" className="block text-xs font-medium text-gray-400 mb-1">Send a test email to</label>
              <div className="flex flex-wrap gap-2">
                <input id="smtp-test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className={`${inputClass} flex-1 min-w-48`} />
                <button
                  type="button"
                  onClick={() => testMutation.mutate(testTo)}
                  disabled={!smtpReady || dirty || !testTo || testMutation.isPending}
                  className={secondaryBtn}
                >
                  {testMutation.isPending ? 'Sending…' : 'Send test email'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {!smtpReady ? 'Save a server and sender address first.' : dirty ? 'Save your changes first; the test uses the saved settings.' : 'Uses the saved settings.'}
              </p>
            </div>
          </section>

          <FormError message={error} />
          <StickyActions variant="page">
            <button type="submit" disabled={!dirty || saveMutation.isPending} className={primaryBtn}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </StickyActions>
        </form>
      )}

      <section className={`${cardClass} mt-6`} aria-labelledby="deliveries-heading">
        <h2 id="deliveries-heading" className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Recent deliveries</h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-gray-500">No reminder digests have been sent yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {deliveries.map((d) => (
              <li key={d.id} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-mono text-xs text-gray-400 w-24 shrink-0">{d.date}</span>
                <span className="text-gray-200 min-w-0 truncate">{d.user?.name ?? d.household?.name ?? 'Unknown'}</span>
                <span className="text-xs text-gray-500">{d.channel === 'EMAIL' ? 'Email' : 'ntfy / webhook'} · {d.reminderCount} {d.reminderCount === 1 ? 'reminder' : 'reminders'}</span>
                <span
                  className={`ml-auto inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider rounded px-2 py-0.5 ${
                    d.status === 'SENT' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'
                  }`}
                >
                  {d.status === 'SENT' ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                  {d.status === 'SENT' ? 'Sent' : `Failed · ${d.attempts} ${d.attempts === 1 ? 'try' : 'tries'}`}
                </span>
                {d.error && <p className="basis-full text-xs text-red-300 break-words">{d.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  )
}
