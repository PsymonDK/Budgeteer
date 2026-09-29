import { RotateCcw, Trash } from 'lucide-react'
import { useIncomeTrash, useRestoreFromTrash, restoreUrl } from '../../hooks/useTrash'

const KIND_LABELS = { salary: 'Salary record', override: 'Monthly override', bonus: 'Bonus', taxcard: 'Tax card' } as const

/** Deleted salary records, overrides, bonuses and tax cards for this user, restorable. */
export function IncomeTrashTab({ targetUserId, fmt }: { targetUserId: string | undefined; fmt: (v: number | string, suffix?: string) => string }) {
  const { data: items = [], isLoading } = useIncomeTrash(targetUserId)
  const restore = useRestoreFromTrash()

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl py-12 text-center">
        <Trash size={24} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-500 text-sm">The trash is empty.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">Deleted income records don't count toward any income until you restore them.</p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800">
        {items.map((item) => (
          <div key={`${item.kind}:${item.id}`} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">
                {item.label}
                <span className="ml-2 text-xs text-gray-500">{KIND_LABELS[item.kind]} · {item.job.name}</span>
              </p>
              <p className="text-xs text-gray-500">
                Deleted {new Date(item.deletedAt).toLocaleDateString()}
                {item.deletedBy?.name && <> by {item.deletedBy.name}</>}
              </p>
            </div>
            {item.netAmount !== null && (
              <span className="text-sm tabular-nums text-gray-300">
                {fmt(item.netAmount, item.currencyCode ?? undefined)} <span className="text-xs text-gray-600">net</span>
              </span>
            )}
            <button
              onClick={() => targetUserId && restore.mutate(restoreUrl({ userId: targetUserId }, item.kind, item.id))}
              disabled={restore.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
            >
              <RotateCcw size={13} /> Restore
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
