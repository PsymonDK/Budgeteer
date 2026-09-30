import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useHouseholdNotificationSettings } from '../../api/queries'
import type { HouseholdNotificationResponse, HouseholdNotificationSettings } from '../../api/types'
import { ChannelToggle } from '../../components/notifications/ChannelToggle'
import { StickyActions } from '../../components/StickyActions'
import { FormError } from '../../components/FormError'
import { inputClass, primaryBtn } from '../../lib/styles'

const LEAD_DAYS = Array.from({ length: 15 }, (_, i) => i)
const OFF_BY_ADMIN = 'Turned off for this install by the administrator.'

/** Household payment-reminder settings (household admins): channels, shared ntfy/webhook URL, lead time. */
export function ReminderSettings({ householdId }: { householdId: string }) {
  const queryClient = useQueryClient()
  const { data } = useHouseholdNotificationSettings(householdId)
  const [form, setForm] = useState<HouseholdNotificationSettings | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (data) setForm(data.settings) }, [data])

  const saveMutation = useMutation({
    mutationFn: (settings: HouseholdNotificationSettings) =>
      api.put<HouseholdNotificationResponse>(`/households/${householdId}/notification-settings`, settings),
    onSuccess: ({ data: saved }) => {
      queryClient.setQueryData(qk.householdNotificationSettings(householdId), saved)
      queryClient.invalidateQueries({ queryKey: qk.reminders() })
      setError('')
      toast.success('Reminder settings saved')
    },
    onError: (err) => {
      const body = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: { fieldErrors?: Record<string, string[]> } }) : undefined
      setError(Object.values(body?.details?.fieldErrors ?? {})[0]?.[0] ?? body?.error ?? 'Failed to save reminder settings')
    },
  })

  if (!data || !form) return null
  const { allowed } = data
  const set = (patch: Partial<HouseholdNotificationSettings>) => setForm({ ...form, ...patch })
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings)

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

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label htmlFor="hh-webhook-url" className="block text-xs font-medium text-gray-400 mb-1">
            Shared ntfy topic or webhook <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="hh-webhook-url"
            type="url"
            inputMode="url"
            value={form.webhookUrl ?? ''}
            onChange={(e) => set({ webhookUrl: e.target.value })}
            placeholder="https://ntfy.sh/our-household"
            disabled={!allowed.webhook || !form.webhookEnabled}
            aria-describedby="hh-webhook-url-help"
            className={inputClass}
          />
          <p id="hh-webhook-url-help" className="text-xs text-gray-500 mt-1">Gets a digest of every manual payment, whoever it belongs to.</p>
        </div>
        <div>
          <label htmlFor="hh-lead-days" className="block text-xs font-medium text-gray-400 mb-1">Remind this many days ahead</label>
          <select
            id="hh-lead-days"
            value={form.leadDays}
            onChange={(e) => set({ leadDays: Number(e.target.value) })}
            className={`${inputClass} sm:w-40`}
          >
            {LEAD_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Only on the day' : `${d} ${d === 1 ? 'day' : 'days'}`}</option>)}
          </select>
          <p className="text-xs text-gray-500 mt-1">The default; members can pick their own.</p>
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
