import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useCurrencies, useHouseholds, useUserMe } from '../../api/queries'
import { useAuth } from '../../contexts/AuthContext'
import Avatar from '../../components/Avatar'
import { PageLoader } from '../../components/LoadingSpinner'
import { inputClass } from '../../lib/styles'
import { cardClass } from './cardClass'
import { StickyActions } from '../../components/StickyActions'

// ── Tab 1: Profile ───────────────────────────────────────────────────────────

export function ProfileTab(_props: { user: ReturnType<typeof useAuth>['user'] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { updateUser } = useAuth()

  const { data: me, isLoading } = useUserMe()

  const { data: currencies = [] } = useCurrencies()

  const { data: households = [] } = useHouseholds()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [profileError, setProfileError] = useState('')
  const [prefError, setPrefError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (me) {
      setName(me.name)
      setEmail(me.email)
      // Keep the header name/avatar (AuthContext) in sync after profile edits
      updateUser({ name: me.name, email: me.email, avatarUrl: me.avatarUrl ?? null })
    }
  }, [me, updateUser])

  const emailChanged = me && email !== me.email
  const showPasswordConfirm = !!emailChanged

  const updateMeMutation = useMutation({
    mutationFn: (body: { name?: string; email?: string; currentPassword?: string }) =>
      api.put('/users/me', body),
    onSuccess: () => {
      setProfileError('')
      setCurrentPassword('')
      queryClient.invalidateQueries({ queryKey: qk.me() })
      toast.success('Profile updated')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setProfileError((err.response?.data as { error?: string })?.error ?? 'Failed to update profile')
      }
    },
  })

  const updatePrefsMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/users/me/preferences', body),
    onSuccess: () => {
      setPrefError('')
      queryClient.invalidateQueries({ queryKey: qk.me() })
      queryClient.invalidateQueries({ queryKey: qk.preferences() })
      toast.success('Preferences saved')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setPrefError((err.response?.data as { error?: string })?.error ?? 'Failed to save preferences')
      }
    },
  })

  async function handleAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarError('')
    const form = new FormData()
    form.append('avatar', file)
    try {
      await api.post('/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      queryClient.invalidateQueries({ queryKey: qk.me() })
      queryClient.invalidateQueries({ queryKey: qk.meAll() })
      toast.success('Avatar updated')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setAvatarError((err.response?.data as { error?: string })?.error ?? 'Failed to upload avatar')
      }
    }
  }

  async function handleAvatarDelete() {
    setAvatarError('')
    try {
      await api.delete('/users/me/avatar')
      queryClient.invalidateQueries({ queryKey: qk.me() })
      queryClient.invalidateQueries({ queryKey: qk.meAll() })
      toast.success('Avatar removed')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setAvatarError((err.response?.data as { error?: string })?.error ?? 'Failed to remove avatar')
      }
    }
  }

  function handleProfileSubmit(e: FormEvent) {
    e.preventDefault()
    setProfileError('')
    const body: { name?: string; email?: string; currentPassword?: string } = {}
    if (me && name !== me.name) body.name = name
    if (me && email !== me.email) {
      body.email = email
      body.currentPassword = currentPassword
    }
    if (Object.keys(body).length === 0) return
    updateMeMutation.mutate(body)
  }

  function handlePrefChange(field: string, value: unknown) {
    updatePrefsMutation.mutate({ [field]: value })
  }

  if (isLoading || !me) {
    return <PageLoader />
  }

  const prefs = me.preferences

  return (
    <div className="space-y-6">
      {/* Personal info */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">Personal information</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-5">
          <Avatar user={me} size={40} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="text-sm text-amber-400 hover:text-amber-300 transition-colors"
            >
              Upload photo
            </button>
            {me.avatarUrl && (
              <button
                type="button"
                onClick={handleAvatarDelete}
                className="text-sm text-gray-500 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        {avatarError && <p className="text-red-400 text-xs mb-3">{avatarError}</p>}

        <form onSubmit={handleProfileSubmit} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          {showPasswordConfirm && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Confirm current password <span className="text-amber-400">(required to change email)</span>
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className={inputClass}
              />
            </div>
          )}
          {profileError && (
            <p className="text-red-400 text-xs">{profileError}</p>
          )}
          <StickyActions variant="page">
            <button
              type="submit"
              disabled={updateMeMutation.isPending}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {updateMeMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/change-password')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Change password
            </button>
          </StickyActions>
        </form>
      </div>

      {/* Preferences */}
      <div className={cardClass}>
        <h2 className="text-base font-semibold mb-4">Preferences</h2>
        <div className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Preferred currency</label>
            <select
              value={prefs?.preferredCurrency ?? 'DKK'}
              onChange={(e) => handlePrefChange('preferredCurrency', e.target.value)}
              className={inputClass}
            >
              {/* Keep the saved preference selectable even if it has no synced rate (e.g. the base currency) */}
              {!currencies.some((c) => c.code === (prefs?.preferredCurrency ?? 'DKK')) && (
                <option value={prefs?.preferredCurrency ?? 'DKK'}>
                  {prefs?.preferredCurrency ?? 'DKK'}
                </option>
              )}
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Default household</label>
            <select
              value={prefs?.defaultHouseholdId ?? ''}
              onChange={(e) => handlePrefChange('defaultHouseholdId', e.target.value || null)}
              className={inputClass}
            >
              <option value="">— None —</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3 pt-2">
            <p className="text-xs font-medium text-gray-400">Notifications</p>
            {[
              { field: 'notifyOverAllocation', label: 'Over-allocation warning' },
              { field: 'notifyExpensesExceedIncome', label: 'Expenses exceed income' },
              { field: 'notifyNoSavings', label: 'No savings entries' },
              { field: 'notifyUncategorised', label: 'Uncategorised expenses' },
            ].map(({ field, label }) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs?.[field as keyof typeof prefs] as boolean ?? false}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handlePrefChange(field, e.target.checked)
                  }
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>

          <div className="space-y-3 pt-2">
            <p className="text-xs font-medium text-gray-400">Dashboard</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs?.showDashboardSparklines ?? true}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handlePrefChange('showDashboardSparklines', e.target.checked)
                }
                className="w-4 h-4 rounded accent-amber-400"
              />
              <span className="text-sm text-gray-300">Show sparkline charts on dashboard tiles</span>
            </label>
          </div>

          {prefError && <p className="text-red-400 text-xs">{prefError}</p>}
        </div>
      </div>
    </div>
  )
}
