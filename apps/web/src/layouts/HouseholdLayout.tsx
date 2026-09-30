import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useMemo } from 'react'
import {
  LayoutDashboard, TrendingUp, PiggyBank, Receipt, ScanLine, Tag,
  Calendar, Clock, ChartNoAxesColumn, Settings, Trash,
} from 'lucide-react'
import { useHousehold } from '../contexts/HouseholdContext'
import HeaderSettingsMenu from '../components/HeaderSettingsMenu'
import HouseholdSwitcher from '../components/HouseholdSwitcher'
import { AddReceiptButton } from '../components/AddReceiptButton'
import { AppShell, type ShellNavItem, type ShellNavSection, type ShellQuickAction } from './AppShell'

export function HouseholdLayout() {
  const { id: householdId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setActiveHousehold } = useHousehold()

  // Keep localStorage in sync when navigating directly to a household URL
  useEffect(() => {
    if (householdId) {
      setActiveHousehold(householdId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  const nav = useMemo(() => {
    const base = `/households/${householdId}`
    const item = (label: string, path: string, icon: ShellNavItem['icon']): ShellNavItem =>
      ({ label, to: path ? `${base}/${path}` : base, icon, end: path === '' })

    const dashboard = item('Dashboard', '', LayoutDashboard)
    const expenses = item('Expenses', 'expenses', Receipt)
    const receipts = item('Receipts', 'receipts', ScanLine)

    const sections: ShellNavSection[] = [
      { items: [dashboard] },
      {
        title: "This year's budget",
        items: [item('Household income', 'income', TrendingUp), expenses, item('Savings', 'savings', PiggyBank), receipts],
      },
      {
        title: 'Plan & look back',
        items: [item('Budget years', 'budget-years', Calendar), item('History', 'history', Clock), item('Compare', 'compare', ChartNoAxesColumn)],
      },
    ]
    const footerItems = [item('Categories', 'categories', Tag), item('Trash', 'trash', Trash), item('Settings', 'settings', Settings)]
    const quickActions: ShellQuickAction[] = [
      { label: 'Add expense', icon: Receipt, onSelect: () => navigate(`${base}/expenses?add=1`) },
      { label: 'Add savings', icon: PiggyBank, onSelect: () => navigate(`${base}/savings?add=1`) },
      { label: 'Scan receipt', icon: ScanLine, onSelect: () => navigate(`${base}/receipts/new`) },
    ]
    return { sections, footerItems, tabs: [dashboard, expenses, receipts], quickActions }
  }, [householdId, navigate])

  return (
    <AppShell
      context={<HouseholdSwitcher currentHouseholdId={householdId!} />}
      actions={
        <>
          {/* On phones the tab bar's Add button covers this */}
          <div className="hidden sm:block"><AddReceiptButton householdId={householdId} /></div>
          <HeaderSettingsMenu householdId={householdId} />
        </>
      }
      sections={nav.sections}
      footerItems={nav.footerItems}
      tabs={nav.tabs}
      quickActions={nav.quickActions}
      // Keyed so switching household remounts the page and drops the previous household's form, filter and selection state
      outletKey={householdId}
    />
  )
}
