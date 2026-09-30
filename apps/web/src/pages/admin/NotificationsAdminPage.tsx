import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { NotificationDeliveryRow, SystemNotificationSettings } from '../../api/types'
import { Page } from '../../components/Page'
import { PageHeader } from '../../components/PageHeader'
import { StickyActions } from '../../components/StickyActions'
import { ChannelToggle } from '../../components/notifications/ChannelToggle'
import { Check, X } from 'lucide-react'
import { getApiError } from '../../lib/apiError'
import { primaryBtn } from '../../lib/styles'

const cardClass = 'bg-gray-900 border border-gray-800 rounded-xl p-6'

/** Which reminder channels this install offers, and the recent delivery log. */
export function NotificationsAdminPage() {
  const queryClient = useQueryClient()
  const { data: saved } = useQuery({
    queryKey: qk.adminNotificationSettings(),
    queryFn: async () => (await api.get<SystemNotificationSettings>('/admin/notification-settings')).data,
  })
  const { data: deliveries = [] } = useQuery({
    queryKey: qk.adminNotificationDeliveries(),
    queryFn: async () => (await api.get<NotificationDeliveryRow[]>('/admin/notification-deliveries', { params: { limit: 50 } })).data,
  })

  const [form, setForm] = useState<SystemNotificationSettings | null>(null)
  useEffect(() => { if (saved) setForm(saved) }, [saved])

  const saveMutation = useMutation({
    mutationFn: (data: SystemNotificationSettings) => api.put<SystemNotificationSettings>('/admin/notification-settings', data),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(qk.adminNotificationSettings(), data)
      // What households and members may turn on changes with it
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] })
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
      toast.success('Notification settings saved')
    },
    onError: (err) => toast.error(getApiError(err, 'Failed to save notification settings')),
  })

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved)
  const set = (patch: Partial<SystemNotificationSettings>) => setForm((f) => (f ? { ...f, ...patch } : f))

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

      {form && (
        <form onSubmit={handleSubmit} className={`${cardClass} space-y-5`}>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Channels on this install</h2>
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
            description="A daily digest by email. Needs an email server; set it up before turning this on."
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
