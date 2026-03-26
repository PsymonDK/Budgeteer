import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'

interface Household {
  id: string
  name: string
  _count: { members: number }
  members: Array<{
    role: 'ADMIN' | 'MEMBER'
    user: { id: string; name: string; email: string }
  }>
}

export function HouseholdsAdminPage() {
  const { data: households = [], isLoading } = useQuery<Household[]>({
    queryKey: ['households', 'admin'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">All Households</h1>
          <span className="text-sm text-gray-500">{households.length} total</span>
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : households.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No households yet.</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Admins</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {households.map((h) => {
                  const admins = h.members.filter((m) => m.role === 'ADMIN')
                  return (
                    <tr key={h.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium text-white">{h.name}</td>
                      <td className="px-4 py-3 text-gray-300">{h._count.members}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">
                        {admins.map((a) => a.user.name).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/households/${h.id}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
