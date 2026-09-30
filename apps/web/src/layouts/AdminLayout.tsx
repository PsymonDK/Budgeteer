import { Bell, Bot, Coins, House, Tag, Users, Zap } from 'lucide-react'
import { AppShell, type ShellNavItem } from './AppShell'

const ADMIN_NAV: ShellNavItem[] = [
  { label: 'Users',            to: '/admin/users',            icon: Users },
  { label: 'Households',       to: '/admin/households',       icon: House },
  { label: 'Currencies',       to: '/admin/currencies',       icon: Coins },
  { label: 'Categories',       to: '/admin/categories',       icon: Tag },
  { label: 'Receipt training', to: '/admin/receipt-training', icon: Bot },
  { label: 'Automations',      to: '/admin/automations',      icon: Zap },
  { label: 'Notifications',    to: '/admin/notifications',    icon: Bell },
]

export function AdminLayout() {
  return (
    <AppShell
      context={<span className="text-gray-400 text-sm">Admin</span>}
      sections={[{ title: 'Administration', items: ADMIN_NAV }]}
      tabs={ADMIN_NAV.slice(0, 3)}
    />
  )
}
