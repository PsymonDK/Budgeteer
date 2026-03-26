import { Link, useLocation } from 'react-router-dom'
import HeaderUserMenu from './HeaderUserMenu'
import { useAuth } from '../contexts/AuthContext'

export function PageHeader() {
  const { user } = useAuth()
  const location = useLocation()
  const isAdmin = user?.role === 'SYSTEM_ADMIN'

  return (
    <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
      <Link to="/" className="text-lg font-bold text-white hover:text-amber-400 transition-colors">
        Budgeteer
      </Link>
      <div className="flex items-center gap-4">
        {isAdmin && (
          <>
            <Link
              to="/admin/users"
              className={`text-sm transition-colors ${location.pathname.startsWith('/admin/users') ? 'text-amber-400' : 'text-gray-400 hover:text-white'}`}
            >
              Users
            </Link>
            <Link
              to="/admin/households"
              className={`text-sm transition-colors ${location.pathname.startsWith('/admin/households') ? 'text-amber-400' : 'text-gray-400 hover:text-white'}`}
            >
              Households
            </Link>
            <Link
              to="/admin/categories"
              className={`text-sm transition-colors ${location.pathname.startsWith('/admin/categories') ? 'text-amber-400' : 'text-gray-400 hover:text-white'}`}
            >
              Categories
            </Link>
          </>
        )}
        <HeaderUserMenu />
      </div>
    </header>
  )
}
