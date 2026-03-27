import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AlertTriangle, User, Home } from 'lucide-react'
import Avatar from '../components/Avatar'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'

const cardClass = 'bg-gray-900 border border-gray-800 rounded-xl p-6'

// ── Types ────────────────────────────────────────────────────────────────────

interface UserMe {
  id: string
  email: string
  name: string
  role: string
  avatarUrl?: string | null
  preferences: {
    preferredCurrency: string
    defaultHouseholdId: string | null
    notifyOverAllocation: boolean
    notifyExpensesExceedIncome: boolean
    notifyNoSavings: boolean
    notifyUncategorised: boolean
  } | null
}

interface Currency {
  currencyCode: string
  name?: string
}

interface Household {
  id: string
  name: string
  myRole: string | null
  members?: unknown[]
}

interface IncomeSummary {
  allocationPct: string
  overAllocated: boolean
}

// ── Tab 1: Profile ───────────────────────────────────────────────────────────

function ProfileTab(_props: { user: ReturnType<typeof useAuth>['user'] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: me, isLoading } = useQuery<UserMe>({
    queryKey: ['users-me'],
    queryFn: async () => (await api.get<UserMe>('/users/me')).data,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

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
    }
  }, [me])

  const emailChanged = me && email !== me.email
  const showPasswordConfirm = !!emailChanged

  const updateMeMutation = useMutation({
    mutationFn: (body: { name?: string; email?: string; currentPassword?: string }) =>
      api.put('/users/me', body),
    onSuccess: () => {
      setProfileError('')
      setCurrentPassword('')
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
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
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
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
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
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
      queryClient.invalidateQueries({ queryKey: ['users-me'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
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
          <div className="flex gap-3">
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
          </div>
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
              {currencies.length === 0 && (
                <option value={prefs?.preferredCurrency ?? 'DKK'}>
                  {prefs?.preferredCurrency ?? 'DKK'}
                </option>
              )}
              {currencies.map((c) => (
                <option key={c.currencyCode} value={c.currencyCode}>
                  {c.currencyCode}
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

          {prefError && <p className="text-red-400 text-xs">{prefError}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Households ────────────────────────────────────────────────────────

function HouseholdsTab() {
  const { data: summary } = useQuery<IncomeSummary>({
    queryKey: ['income-summary-me'],
    queryFn: async () => (await api.get<IncomeSummary>('/users/me/income/summary')).data,
  })

  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  return (
    <div className="space-y-6">
      {summary?.overAllocated && (
        <div className="flex items-center gap-3 bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            Your income is over-allocated ({summary.allocationPct}%). Review your allocations on the{' '}
            <Link to="/income" className="underline hover:text-red-200">Income page</Link>.
          </span>
        </div>
      )}

      {isLoading ? (
        <PageLoader />
      ) : households.length === 0 ? (
        <div className={cardClass}>
          <p className="text-gray-400 text-sm">
            You are not a member of any household.{' '}
            <Link to="/" className="text-amber-400 hover:text-amber-300">Go to households →</Link>
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {households.map((hh) => (
            <div key={hh.id} className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold">{hh.name}</h3>
                    {hh.myRole && (
                      <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        {hh.myRole}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    <Link to={`/households/${hh.id}`} className="text-amber-400 hover:text-amber-300">
                      Open household →
                    </Link>
                  </p>
                </div>
                <Link
                  to={`/households/${hh.id}`}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <Home size={18} />
                </Link>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                To view or edit income allocations for this household,{' '}
                <Link to="/income" className="text-amber-400 hover:text-amber-300">
                  go to the Income page →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ProfilePage ─────────────────────────────────────────────────────────

type TabKey = 'profile' | 'households'

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'households', label: 'Households', icon: Home },
]

export function ProfilePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Page content */}
      <main className="flex-1 px-6 py-8 max-w-4xl w-full mx-auto">
        <PageHeader title="Your profile" />

        {/* Tab bar */}
        <div className="border-b border-gray-800 mb-6">
          <nav className="flex gap-0 -mb-px">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {tab === 'profile' && <ProfileTab user={user} />}
        {tab === 'households' && <HouseholdsTab />}
      </main>
    </div>
  )
}
