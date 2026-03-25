import { Link, Outlet, useParams, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import {
  LayoutDashboard, TrendingUp, PiggyBank, Receipt, Tag,
  Calendar, Clock, BarChart2, Settings,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useHousehold } from '../contexts/HouseholdContext'
import { AppFooter } from '../components/AppFooter'
import HeaderUserMenu from '../components/HeaderUserMenu'
import HouseholdSwitcher from '../components/HouseholdSwitcher'

const NAV_ITEMS = [
  { label: 'Dashboard',    path: '',             icon: LayoutDashboard },
  { label: 'Income',       path: 'income',       icon: TrendingUp },
  { label: 'Savings',      path: 'savings',      icon: PiggyBank },
  { label: 'Expenses',     path: 'expenses',     icon: Receipt },
  { label: 'Categories',   path: 'categories',   icon: Tag },
  { label: 'Budget Years', path: 'budget-years', icon: Calendar },
  { label: 'History',      path: 'history',      icon: Clock },
  { label: 'Compare',      path: 'compare',      icon: BarChart2 },
]

export function HouseholdLayout() {
  const { id: householdId } = useParams<{ id: string }>()
  const location = useLocation()
  const { user } = useAuth()
  const { setActiveHousehold } = useHousehold()

  // Keep localStorage in sync when navigating directly to a household URL
  useEffect(() => {
    if (householdId) {
      setActiveHousehold(householdId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  function isActive(path: string) {
    const base = `/households/${householdId}`
    if (path === '') return location.pathname === base
    return location.pathname.startsWith(`${base}/${path}`)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-amber-400 font-bold text-lg hover:text-amber-300 transition-colors">
            ☠️ Budgeteer
          </Link>
          <span className="text-gray-600">/</span>
          <HouseholdSwitcher currentHouseholdId={householdId!} />
        </div>
        <div className="flex items-center gap-5">
          <Link to="/income" className="text-sm text-gray-400 hover:text-white transition-colors">
            My income
          </Link>
          {user?.role === 'SYSTEM_ADMIN' && (
            <Link to="/admin/users" className="text-sm text-gray-400 hover:text-white transition-colors">
              Users
            </Link>
          )}
          <HeaderUserMenu />
        </div>
      </header>

      {/* Sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <nav className="w-56 bg-gray-900 border-r border-gray-800 flex-shrink-0 flex flex-col py-4">
          <div className="flex-1 px-3 space-y-0.5">
            {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
              const active = isActive(path)
              return (
                <Link
                  key={path}
                  to={`/households/${householdId}${path ? `/${path}` : ''}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? 'bg-gray-800 text-white font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-amber-400' : 'text-gray-500'} />
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Settings pinned at bottom */}
          <div className="px-3 pt-3 border-t border-gray-800 mt-3">
            {(() => {
              const active = isActive('settings')
              return (
                <Link
                  to={`/households/${householdId}/settings`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? 'bg-gray-800 text-white font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  <Settings size={16} className={active ? 'text-amber-400' : 'text-gray-500'} />
                  Settings
                </Link>
              )
            })()}
          </div>
        </nav>

        {/* Main content */}
        <div className="flex-1 overflow-auto flex flex-col">
          <div className="flex-1">
            <Outlet />
          </div>
          <AppFooter />
        </div>
      </div>
    </div>
  )
}
