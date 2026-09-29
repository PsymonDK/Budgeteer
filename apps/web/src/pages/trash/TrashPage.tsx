import { useParams } from 'react-router-dom'
import { Trash2, RotateCcw } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { PageLoader } from '../../components/LoadingSpinner'
import { DataTable, type DataColumn } from '../../components/DataTable'
import { useFmt } from '../../hooks/useFmt'
import { useHouseholdTrash, useRestoreFromTrash, restoreUrl } from '../../hooks/useTrash'
import { yearLabel } from '../../lib/budgetYear'
import { FREQ_LABELS } from '../../lib/constants'
import { Page } from '../../components/Page'

type TrashItem = NonNullable<ReturnType<typeof useHouseholdTrash>['data']>[number]
/** Expenses and savings live in separate tables, so the row key combines kind and id. */
type TrashRow = { id: string; item: TrashItem }

const deletedLabel = ({ item }: TrashRow) =>
  `${new Date(item.deletedAt).toLocaleDateString()}${item.deletedBy?.name ? ` by ${item.deletedBy.name}` : ''}`

/** Household trash: deleted expenses and savings entries, restorable. */
export function TrashPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const fmt = useFmt()
  const { data: items = [], isLoading } = useHouseholdTrash(householdId)
  const restore = useRestoreFromTrash()

  if (isLoading) return <PageLoader />

  const rows: TrashRow[] = items.map((item) => ({ id: `${item.kind}:${item.id}`, item }))
  const columns: DataColumn<TrashRow>[] = [
    {
      key: 'item', header: 'Item',
      cell: ({ item }) => (
        <>
          <p className="text-white">
            {item.label}
            <span className={`ml-2 text-xs ${item.kind === 'savings' ? 'text-blue-400' : 'text-gray-500'}`}>
              {item.kind === 'savings' ? 'savings' : 'expense'}
            </span>
          </p>
          <p className="text-xs text-gray-500">
            {item.categoryName ?? 'Uncategorised'} · {FREQ_LABELS[item.frequency] ?? item.frequency}
          </p>
        </>
      ),
    },
    {
      key: 'year', header: 'Budget year', priority: 2,
      cell: ({ item }) => <span className="text-gray-300">{yearLabel(item.budgetYear)}</span>,
      summary: ({ item }) => yearLabel(item.budgetYear),
    },
    {
      key: 'monthly', header: '/ month', priority: 2, align: 'right',
      cell: ({ item }) => <span className="tabular-nums text-gray-300 whitespace-nowrap">{fmt(item.monthlyEquivalent)}</span>,
      summary: ({ item }) => fmt(item.monthlyEquivalent),
    },
    {
      key: 'deleted', header: 'Deleted', priority: 3,
      cell: (row) => <span className="text-xs text-gray-500">{deletedLabel(row)}</span>,
      summary: deletedLabel,
    },
    {
      key: 'restore', header: <span className="sr-only">Restore</span>, align: 'right',
      cell: ({ item }) => item.canRestore ? (
        <button
          onClick={() => householdId && restore.mutate(restoreUrl({ householdId }, item.kind, item.id))}
          disabled={restore.isPending}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <RotateCcw size={13} /> Restore
        </button>
      ) : (
        <span className="text-xs text-gray-600 whitespace-nowrap" title="Retired budget years are read-only">Retired year</span>
      ),
    },
  ]

  return (
    <Page template="list">
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
        <DataTable rows={rows} columns={columns} />
      )}
    </Page>
  )
}
