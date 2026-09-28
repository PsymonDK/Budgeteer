import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useHouseholdDetail } from '../../api/queries'
import type { Account } from '../../api/types'
import { useAuth } from '../../contexts/AuthContext'
import { PageLoader } from '../../components/LoadingSpinner'
import { HouseholdNameHeader } from './HouseholdNameHeader'
import { MembersSection } from './MembersSection'
import { HouseholdAccountsSection } from './HouseholdAccountsSection'
import { DangerZone, TransferSettings } from './HouseholdAdminSettings'

/** Household settings: name, members, accounts, transfer settings and deactivation. */
export function HouseholdPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()

  const { data: household, isLoading } = useHouseholdDetail(id)

  const isAdmin = household?.myRole === 'ADMIN' || me?.role === 'SYSTEM_ADMIN'

  const { data: householdAccounts = [] } = useQuery<Account[]>({
    queryKey: qk.accountsHousehold(id),
    queryFn: async () => (await api.get<Account[]>(`/households/${id}/accounts`)).data,
    enabled: !!id,
  })

  if (isLoading) {
    return <PageLoader />
  }

  if (!household) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Household not found.</p>
          <Link to="/" className="text-amber-400 hover:text-amber-300 text-sm">← Back to households</Link>
        </div>
      </div>
    )
  }

  const householdId = id!

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Household name */}
        <HouseholdNameHeader householdId={householdId} household={household} isAdmin={isAdmin} />

        {/* Members */}
        <MembersSection householdId={householdId} household={household} isAdmin={isAdmin} me={me} />

        {/* Household accounts */}
        <HouseholdAccountsSection householdId={householdId} accounts={householdAccounts} isAdmin={isAdmin} />

        {/* Budget transfer settings */}
        {isAdmin && <TransferSettings householdId={householdId} household={household} />}

        {/* Danger zone */}
        {isAdmin && <DangerZone householdId={householdId} household={household} />}
      </main>
    </>
  )
}
