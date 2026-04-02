import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface Props { householdId?: string }

export default function HeaderSettingsMenu({ householdId }: Props) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!user) return null
  const showHousehold = Boolean(householdId)
  const showAdmin = user.role === 'SYSTEM_ADMIN'
  if (!showHousehold && !showAdmin) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center focus:outline-none"
        aria-label="Settings menu"
      >
        <Settings size={20} className="text-gray-400 hover:text-white transition-colors" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="py-1">
            {showHousehold && (
              <Link
                to={`/households/${householdId}/settings`}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                Household Settings
              </Link>
            )}
            {showAdmin && (
              <Link
                to="/admin/users"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                Admin Panel
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
