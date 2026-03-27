import { Link, Outlet } from 'react-router-dom'
import { useHousehold } from '../contexts/HouseholdContext'
import { useAuth } from '../contexts/AuthContext'
import { AppFooter } from '../components/AppFooter'
import HeaderUserMenu from '../components/HeaderUserMenu'
import { ChevronLeft } from 'lucide-react'

export function GlobalLayout() {
  const { activeHouseholdId } = useHousehold()
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-amber-400 font-bold text-lg hover:text-amber-300 transition-colors">
            ☠️ Budgeteer
          </Link>
          {activeHouseholdId && (
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
          {user?.role === 'SYSTEM_ADMIN' && (
            <Link to="/admin/users" className="text-sm text-gray-400 hover:text-white transition-colors">
              Admin
            </Link>
          )}
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
