import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useHouseholdNotificationSettings } from '../../api/queries'
import type { HouseholdNotificationResponse, HouseholdNotificationSettings } from '../../api/types'
import { ChannelToggle } from '../../components/notifications/ChannelToggle'
import { WebhookFields } from '../../components/notifications/WebhookFields'
import { StickyActions } from '../../components/StickyActions'
import { FormError } from '../../components/FormError'
import { getApiError } from '../../lib/apiError'
import { inputClass, primaryBtn } from '../../lib/styles'

const LEAD_DAYS = Array.from({ length: 15 }, (_, i) => i)
const OFF_BY_ADMIN = 'Turned off for this install by the administrator.'

/** Household payment-reminder settings (household admins): channels, shared ntfy/webhook, lead time. */
export function ReminderSettings({ householdId }: { householdId: string }) {
  const queryClient = useQueryClient()
  const { data } = useHouseholdNotificationSettings(householdId)
  const [form, setForm] = useState<HouseholdNotificationSettings | null>(null)
  const [error, setError] = useState('')
  // A new webhook secret being typed, or the saved one to remove; never loaded from the server
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  useEffect(() => { if (data) setForm(data.settings) }, [data])

  const saveMutation = useMutation({
    mutationFn: ({ webhookSecretSet: _set, ...settings }: HouseholdNotificationSettings) =>
      api.put<HouseholdNotificationResponse>(`/households/${householdId}/notification-settings`, {
        ...settings,
        ...(clearSecret ? { webhookSecret: null } : secret ? { webhookSecret: secret } : {}),
      }),
    onSuccess: ({ data: saved }) => {
      queryClient.setQueryData(qk.householdNotificationSettings(householdId), saved)
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
      setSecret('')
      setClearSecret(false)
      setError('')
      toast.success('Reminder settings saved')
    },
    onError: (err) => {
      const body = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: { fieldErrors?: Record<string, string[]> } }) : undefined
      setError(Object.values(body?.details?.fieldErrors ?? {})[0]?.[0] ?? body?.error ?? 'Failed to save reminder settings')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => api.post(`/households/${householdId}/notification-settings/test-webhook`),
    onSuccess: () => toast.success('Test sent — check the ntfy topic or webhook'),
    onError: (err) => toast.error(getApiError(err, 'The test could not be sent')),
  })

  if (!data || !form) return null
  const { allowed } = data
  const set = (patch: Partial<HouseholdNotificationSettings>) => setForm({ ...form, ...patch })
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings) || !!secret || clearSecret
  const webhookUsable = allowed.webhook && form.webhookEnabled

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form) saveMutation.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 border border-gray-800 rounded-xl p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Payment reminders</h2>
        <p className="text-xs text-gray-500 mt-1">
          Reminders for what the household pays by hand. Members can turn channels off for themselves.
        </p>
      </div>

      <div className="space-y-4">
        <ChannelToggle
          id="hh-in-app"
          label="In the app"
          description="A count on the Dashboard link and a summary on the to-pay list."
          checked={form.inAppEnabled}
          onChange={(inAppEnabled) => set({ inAppEnabled })}
          allowed={allowed.inApp}
          blockedNote={OFF_BY_ADMIN}
        />
        <ChannelToggle
          id="hh-email"
          label="Email"
          description="Each member gets a daily digest of what's due."
          checked={form.emailEnabled}
          onChange={(emailEnabled) => set({ emailEnabled })}
          allowed={allowed.email}
          blockedNote={OFF_BY_ADMIN}
        />
        <ChannelToggle
          id="hh-webhook"
          label="ntfy and webhooks"
          description="Members' own ntfy topics or webhooks, and the household's shared one below."
          checked={form.webhookEnabled}
          onChange={(webhookEnabled) => set({ webhookEnabled })}
          allowed={allowed.webhook}
          blockedNote={OFF_BY_ADMIN}
        />
      </div>

      {webhookUsable && (
        <div className="border-t border-gray-800 pt-4">
          <p className="text-sm font-medium text-gray-100 mb-1">Shared ntfy topic or webhook <span className="text-gray-600 font-normal">(optional)</span></p>
          <p className="text-xs text-gray-500 mb-3">Gets a daily digest of every manual payment, whoever it belongs to.</p>
          <WebhookFields
            idPrefix="hh-webhook"
            format={form.webhookFormat}
            onFormat={(webhookFormat) => set({ webhookFormat })}
            url={form.webhookUrl ?? ''}
            onUrl={(webhookUrl) => set({ webhookUrl })}
            urlPlaceholder="https://ntfy.sh/our-household"
            urlHelp={data.allowPrivateNetwork ? 'Private-network addresses are allowed on this install.' : undefined}
            secretSet={form.webhookSecretSet}
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

      <div>
        <label htmlFor="hh-lead-days" className="block text-xs font-medium text-gray-400 mb-1">Remind this many days ahead</label>
        <select
          id="hh-lead-days"
          value={form.leadDays}
          onChange={(e) => set({ leadDays: Number(e.target.value) })}
          className={`${inputClass} sm:w-48`}
        >
          {LEAD_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Only on the day' : `${d} ${d === 1 ? 'day' : 'days'}`}</option>)}
        </select>
        <p className="text-xs text-gray-500 mt-1">The default; members can pick their own.</p>
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
