import { Link, Outlet, useLocation } from 'react-router-dom'
import { useHousehold } from '../contexts/HouseholdContext'
import { AppFooter } from '../components/AppFooter'
import HeaderUserMenu from '../components/HeaderUserMenu'
import HeaderSettingsMenu from '../components/HeaderSettingsMenu'
import { ChevronLeft } from 'lucide-react'

export function GlobalLayout() {
  const { activeHouseholdId } = useHousehold()
  const location = useLocation()
  const isDashboard = location.pathname === '/'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-amber-400 font-bold text-lg hover:text-amber-300 transition-colors">
            ☠️ Budgeteer
          </Link>
          {!isDashboard && activeHouseholdId && (
            <>
              <span className="text-gray-600">/</span>
              <Link
                to={`/households/${activeHouseholdId}`}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={14} />
                Back to household
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <HeaderSettingsMenu />
          <HeaderUserMenu />
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        <Outlet />
      </div>
      <AppFooter />
    </div>
  )
}
