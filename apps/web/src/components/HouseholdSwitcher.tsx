import { useRef, useEffect, useState } from 'react'
import { ChevronDown, Pin, PinOff, Plus } from 'lucide-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useHousehold } from '../contexts/HouseholdContext'
import { useAuth } from '../contexts/AuthContext'

interface Household { id: string; name: string; myRole: 'ADMIN' | 'MEMBER' | null }

interface Props { currentHouseholdId: string }

export default function HouseholdSwitcher({ currentHouseholdId }: Props) {
  const { setActiveHousehold } = useHousehold()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
    enabled: !!user,
  })

  const { data: preferences } = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => (await api.get('/users/me')).data.preferences,
    enabled: !!user,
  })

  const pinMutation = useMutation({
    mutationFn: (id: string) => api.put('/users/me/preferences', { defaultHouseholdId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['preferences'] }),
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<Household>('/households', { name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['households'] })
      setShowCreate(false)
      setNewName('')
      setActiveHousehold(res.data.id)
      navigate(`/households/${res.data.id}`)
    },
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const current = households.find((h) => h.id === currentHouseholdId)
  const defaultId = preferences?.defaultHouseholdId

  if (households.length <= 1) {
    return (
      <Link to={`/households/${currentHouseholdId}`} className="text-gray-300 text-sm hover:text-white transition-colors">
        {current?.name ?? '…'}
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-0.5">
        <Link
          to={`/households/${currentHouseholdId}`}
          className="text-gray-300 text-sm hover:text-white transition-colors"
          onClick={() => setOpen(false)}
        >
          {current?.name ?? '…'}
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-gray-500 hover:text-white transition-colors p-0.5"
          aria-label="Switch household"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-xl shadow-lg z-50 overflow-hidden">
          {households.map((h) => (
            <div
              key={h.id}
              className={`flex items-center justify-between px-4 py-2.5 hover:bg-gray-800 cursor-pointer group ${h.id === currentHouseholdId ? 'bg-gray-800/60' : ''}`}
            >
              <button
                className="flex-1 text-left text-sm text-gray-300 hover:text-white truncate"
                onClick={() => {
                  setOpen(false)
                  setActiveHousehold(h.id)
                  const match = location.pathname.match(/^\/households\/[^/]+(\/.*)?$/)
                  const subPath = match?.[1] ?? ''
                  navigate(`/households/${h.id}${subPath}`)
                }}
              >
                {h.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); pinMutation.mutate(h.id) }}
                title={h.id === defaultId ? 'Default household' : 'Set as default'}
                className="ml-2 text-gray-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                {h.id === defaultId ? <Pin size={13} className="text-amber-400 opacity-100" /> : <PinOff size={13} />}
              </button>
            </div>
          ))}
          <div className="border-t border-gray-800">
            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-500 hover:text-amber-400 hover:bg-gray-800 transition-colors"
              >
                <Plus size={14} /> New household
              </button>
            ) : (
              <form
                onSubmit={(e) => { e.preventDefault(); createMutation.mutate(newName) }}
                className="px-4 py-2.5 flex gap-2"
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Household name"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <button type="submit" disabled={createMutation.isPending} className="text-xs text-amber-400 hover:text-amber-300">
                  {createMutation.isPending ? '…' : 'Create'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
