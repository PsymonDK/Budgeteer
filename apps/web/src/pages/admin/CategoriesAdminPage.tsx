import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'

interface Category {
  id: string
  name: string
  isSystemWide: boolean
  householdId: string | null
  createdBy: { id: string; name: string }
  _count: { expenses: number }
}

export function CategoriesAdminPage() {
  const queryClient = useQueryClient()

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['categories', 'admin'],
    queryFn: async () => (await api.get<Category[]>('/categories')).data,
  })

  const promoteMutation = useMutation({
    mutationFn: (id: string) => api.post(`/categories/${id}/promote`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', 'admin'] }),
  })

  const customCategories = categories.filter((c) => !c.isSystemWide)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Custom Categories</h1>
          <span className="text-sm text-gray-500">{customCategories.length} total</span>
        </div>

        <p className="text-sm text-gray-400 mb-6">
          Promote a household category to make it available to all households as a system-wide category.
        </p>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : customCategories.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No custom categories yet.</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Created by</th>
                  <th className="px-4 py-3 font-medium">Expenses</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customCategories.map((c) => (
                  <tr key={c.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-gray-300">{c.createdBy.name}</td>
                    <td className="px-4 py-3 text-gray-400">{c._count.expenses}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => promoteMutation.mutate(c.id)}
                        disabled={promoteMutation.isPending}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                      >
                        Promote to system-wide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
