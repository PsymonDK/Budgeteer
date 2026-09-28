import { useParams } from 'react-router-dom'
import { Trash2, RotateCcw } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { PageLoader } from '../../components/LoadingSpinner'
import { useFmt } from '../../hooks/useFmt'
import { useHouseholdTrash, useRestoreFromTrash, restoreUrl } from '../../hooks/useTrash'
import { yearLabel } from '../../lib/budgetYear'
import { FREQ_LABELS } from '../../lib/constants'

/** Household trash: deleted expenses and savings entries, restorable. */
export function TrashPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const fmt = useFmt()
  const { data: items = [], isLoading } = useHouseholdTrash(householdId)
  const restore = useRestoreFromTrash()

  if (isLoading) return <PageLoader />

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <PageHeader
        title="Trash"
        subtitle="Deleted expenses and savings entries. They don't count toward any totals until you restore them."
      />

      {items.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl py-12 text-center">
          <Trash2 size={24} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-500 text-sm">The trash is empty.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Budget year</th>
                  <th className="px-4 py-3 font-medium text-right">/ month</th>
                  <th className="px-4 py-3 font-medium">Deleted</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.kind}:${item.id}`} className="border-b border-gray-800 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-white">
                        {item.label}
                        <span className={`ml-2 text-xs ${item.kind === 'savings' ? 'text-blue-400' : 'text-gray-500'}`}>
                          {item.kind === 'savings' ? 'savings' : 'expense'}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {item.categoryName ?? 'Uncategorised'} · {FREQ_LABELS[item.frequency] ?? item.frequency}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{yearLabel(item.budgetYear)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmt(item.monthlyEquivalent)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(item.deletedAt).toLocaleDateString()}
                      {item.deletedBy?.name && <> by {item.deletedBy.name}</>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.canRestore ? (
                        <button
                          onClick={() => householdId && restore.mutate(restoreUrl({ householdId }, item.kind, item.id))}
                          disabled={restore.isPending}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600" title="Retired budget years are read-only">Retired year</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
