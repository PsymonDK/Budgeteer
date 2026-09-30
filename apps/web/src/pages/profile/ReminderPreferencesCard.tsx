import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useMyNotificationSettings } from '../../api/queries'
import type { UserReminderSettings } from '../../api/types'
import { ChannelToggle } from '../../components/notifications/ChannelToggle'
import { WebhookFields } from '../../components/notifications/WebhookFields'
import { StickyActions } from '../../components/StickyActions'
import { FormError } from '../../components/FormError'
import { getApiError } from '../../lib/apiError'
import { inputClass, primaryBtn } from '../../lib/styles'
import { cardClass } from './cardClass'

const LEAD_DAYS = Array.from({ length: 15 }, (_, i) => i)
const OFF_BY_ADMIN = 'Turned off for this install by the administrator.'

/** The member's own payment-reminder settings: channels, where to send them, how far ahead and when. */
export function ReminderPreferencesCard() {
  const queryClient = useQueryClient()
  const { data } = useMyNotificationSettings()
  const [form, setForm] = useState<UserReminderSettings | null>(null)
  const [error, setError] = useState('')
  // A new webhook secret being typed, or the saved one to remove; never loaded from the server
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  useEffect(() => { if (data) setForm(data.settings) }, [data])

  const saveMutation = useMutation({
    mutationFn: ({ reminderWebhookSecretSet: _set, ...settings }: UserReminderSettings) =>
      api.put('/users/me/preferences', {
        ...settings,
        ...(clearSecret ? { reminderWebhookSecret: null } : secret ? { reminderWebhookSecret: secret } : {}),
      }),
    onSuccess: () => {
      setSecret('')
      setClearSecret(false)
      queryClient.invalidateQueries({ queryKey: qk.myNotificationSettings() })
      queryClient.invalidateQueries({ queryKey: qk.me() })
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
      setError('')
      toast.success('Reminder settings saved')
    },
    onError: (err) => {
      const body = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: { fieldErrors?: Record<string, string[]> } }) : undefined
      setError(Object.values(body?.details?.fieldErrors ?? {})[0]?.[0] ?? body?.error ?? 'Failed to save reminder settings')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => api.post('/me/notification-settings/test-webhook'),
    onSuccess: () => toast.success('Test sent — check your ntfy app or webhook'),
    onError: (err) => toast.error(getApiError(err, 'The test could not be sent')),
  })

  if (!data || !form) return null
  const { allowed, loginEmail } = data
  const set = (patch: Partial<UserReminderSettings>) => setForm({ ...form, ...patch })
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings) || !!secret || clearSecret

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form) saveMutation.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} space-y-5`}>
      <div>
        <h2 className="text-base font-semibold">Payment reminders</h2>
        <p className="text-xs text-gray-500 mt-1">
          For what your households pay by hand. A household can turn a channel off for its payments.
        </p>
      </div>

      <div className="space-y-4">
        <ChannelToggle
          id="me-in-app"
          label="In the app"
          description="A count on the Dashboard link and a summary on the to-pay list."
          checked={form.reminderInApp}
          onChange={(reminderInApp) => set({ reminderInApp })}
          allowed={allowed.inApp}
          blockedNote={OFF_BY_ADMIN}
        />

        <div className="space-y-2">
          <ChannelToggle
            id="me-email"
            label="Email"
            description="A daily digest of what's due soon, due today and overdue."
            checked={form.reminderEmail}
            onChange={(reminderEmail) => set({ reminderEmail })}
            allowed={allowed.email}
            blockedNote={OFF_BY_ADMIN}
          />
          {allowed.email && form.reminderEmail && (
            <div className="pl-7">
              <label htmlFor="me-email-address" className="block text-xs font-medium text-gray-400 mb-1">
                Send to <span className="text-gray-600">(optional)</span>
              </label>
              <input
                id="me-email-address"
                type="email"
                value={form.reminderEmailAddress ?? ''}
                onChange={(e) => set({ reminderEmailAddress: e.target.value })}
                placeholder={loginEmail}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <ChannelToggle
            id="me-webhook"
            label="ntfy or webhook"
            description="A daily digest posted to your own ntfy topic or webhook."
            checked={form.reminderWebhook}
            onChange={(reminderWebhook) => set({ reminderWebhook })}
            allowed={allowed.webhook}
            blockedNote={OFF_BY_ADMIN}
          />
          {allowed.webhook && form.reminderWebhook && (
            <div className="pl-7">
              <WebhookFields
                idPrefix="me-webhook"
                format={form.reminderWebhookFormat}
                onFormat={(reminderWebhookFormat) => set({ reminderWebhookFormat })}
                url={form.reminderWebhookUrl ?? ''}
                onUrl={(reminderWebhookUrl) => set({ reminderWebhookUrl })}
                urlPlaceholder="https://ntfy.sh/your-topic"
                urlHelp="Nothing is sent until you add one."
                secretSet={form.reminderWebhookSecretSet}
                secret={secret}
                onSecret={(v) => { setSecret(v); setClearSecret(false) }}
                clearSecret={clearSecret}
                onClearSecret={() => { setClearSecret(true); setSecret('') }}
                onTest={() => testMutation.mutate()}
                testPending={testMutation.isPending}
                dirty={dirty}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="me-lead-days" className="block text-xs font-medium text-gray-400 mb-1">Remind this many days ahead</label>
          <select
            id="me-lead-days"
            value={form.reminderLeadDays ?? ''}
            onChange={(e) => set({ reminderLeadDays: e.target.value === '' ? null : Number(e.target.value) })}
            className={inputClass}
          >
            <option value="">Household default</option>
            {LEAD_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Only on the day' : `${d} ${d === 1 ? 'day' : 'days'}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="me-digest-time" className="block text-xs font-medium text-gray-400 mb-1">Daily digest at</label>
          <input
            id="me-digest-time"
            type="time"
            value={form.reminderDigestTime}
            onChange={(e) => set({ reminderDigestTime: e.target.value })}
            required
            className={inputClass}
          />
        </div>
      </div>

      <FormError message={error} />
      <StickyActions variant="page">
        <button type="submit" disabled={!dirty || saveMutation.isPending} className={primaryBtn}>
          {saveMutation.isPending ? 'Saving…' : 'Save reminder settings'}
        </button>
      </StickyActions>
    </form>
  )
}
