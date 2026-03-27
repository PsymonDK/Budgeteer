import { Link, Outlet, useLocation } from 'react-router-dom'
import { AppFooter } from '../components/AppFooter'
import HeaderUserMenu from '../components/HeaderUserMenu'

const ADMIN_NAV = [
  { label: 'Users',       path: '/admin/users' },
  { label: 'Households',  path: '/admin/households' },
  { label: 'Currencies',  path: '/admin/currencies' },
  { label: 'Categories',  path: '/admin/categories' },
]

export function AdminLayout() {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-amber-400 font-bold text-lg hover:text-amber-300 transition-colors">
            ☠️ Budgeteer
          </Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400 text-sm">Admin</span>
          <span className="text-gray-600">·</span>
          <nav className="flex items-center gap-4">
            {ADMIN_NAV.map(({ label, path }) => (
              <Link
                key={path}
                to={path}
                className={`text-sm transition-colors ${
                  location.pathname.startsWith(path)
                    ? 'text-amber-400 font-medium'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <HeaderUserMenu />
      </header>

      <div className="flex-1 flex flex-col">
        <Outlet />
      </div>
      <AppFooter />
    </div>
  )
}
