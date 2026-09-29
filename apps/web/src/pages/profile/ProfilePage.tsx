import { useState } from 'react'
import { User, House, CreditCard } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { PageHeader } from '../../components/PageHeader'
import { ProfileTab } from './ProfileTab'
import { HouseholdsTab } from './HouseholdsTab'
import { AccountsTab } from './AccountsTab'

type TabKey = 'profile' | 'households' | 'accounts'

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'households', label: 'Households', icon: House },
  { key: 'accounts', label: 'Accounts', icon: CreditCard },
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
        {tab === 'accounts' && <AccountsTab />}
      </main>
    </div>
  )
}
