import { useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Home, LayoutDashboard, ScanLine, TrendingUp } from 'lucide-react'
import { useHousehold } from '../contexts/HouseholdContext'
import { useHouseholds } from '../api/queries'
import HeaderSettingsMenu from '../components/HeaderSettingsMenu'
import { AddReceiptButton, useReceiptTargetHousehold } from '../components/AddReceiptButton'
import { AppShell, type ShellNavItem, type ShellNavSection } from './AppShell'

export function GlobalLayout() {
  const { activeHouseholdId } = useHousehold()
  const location = useLocation()
  const navigate = useNavigate()
  const isDashboard = location.pathname === '/'
  const { data: households = [] } = useHouseholds()
  const receiptHouseholdId = useReceiptTargetHousehold()

  const nav = useMemo(() => {
    const overview: ShellNavItem = { label: 'Overview', to: '/', icon: LayoutDashboard, end: true }
    const income: ShellNavItem = { label: 'Personal income', to: '/income', icon: TrendingUp }
    const sections: ShellNavSection[] = [{ items: [overview, income] }]
    if (households.length > 0) {
      sections.push({
        title: 'Households',
        items: households.map((h) => ({ label: h.name, to: `/households/${h.id}`, icon: Home })),
      })
    }
    return { sections, tabs: [overview, { ...income, label: 'Income' }] }
  }, [households])

  return (
    <AppShell
      context={!isDashboard && activeHouseholdId ? (
        <Link
          to={`/households/${activeHouseholdId}`}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors whitespace-nowrap"
        >
          <ChevronLeft size={14} />
          Back to household
        </Link>
      ) : undefined}
      actions={
        <>
          {isDashboard && <div className="hidden sm:block"><AddReceiptButton /></div>}
          <HeaderSettingsMenu />
        </>
      }
      sections={nav.sections}
      tabs={nav.tabs}
      quickActions={receiptHouseholdId
        ? [{ label: 'Add receipt', icon: ScanLine, onSelect: () => navigate(`/households/${receiptHouseholdId}/receipts/new`) }]
        : []}
    />
  )
}
