import type { BudgetTransfer } from '../../hooks/useTransfers'
import type { TransferBreakdown } from '../../hooks/useTransferBreakdown'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Fmt = (v: number | string) => string

interface TransferHistoryProps {
  transfers: BudgetTransfer[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onMarkPaid: (t: BudgetTransfer) => void
  onRevert: (t: BudgetTransfer) => void
  fmt: Fmt
}

/** Collapsible table of the budget year's monthly transfers. */
export function TransferHistory({ transfers, collapsed: historyCollapsed, onToggleCollapsed, onMarkPaid, onRevert, fmt }: TransferHistoryProps) {
  return (
    <div>
      <button
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3 hover:text-gray-300 transition-colors"
      >
        <span>Transfer History</span>
        <span className="text-gray-600">{historyCollapsed ? '▸' : '▾'}</span>
      </button>
      {!historyCollapsed && (
        transfers.length === 0 ? (
          <p className="text-gray-600 text-sm py-4 text-center bg-gray-900 border border-gray-800 rounded-xl">
            No transfers recorded yet
          </p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-right">Calculated</th>
                  <th className="px-4 py-3 font-medium text-right">Actual</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-white tabular-nums">
                      {MONTH_NAMES[(t.month - 1) % 12]} {t.year}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmt(t.calculatedAmount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                      {t.actualAmount ? fmt(t.actualAmount) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.status === 'PAID' ? 'bg-green-900/50 text-green-300' :
                        t.status === 'ADJUSTED' ? 'bg-orange-900/50 text-orange-300' :
                        'bg-gray-800 text-gray-400'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {t.status === 'PENDING' ? (
                        <button
                          onClick={() => onMarkPaid(t)}
                          className="text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors"
                        >
                          Mark as Paid
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
                          {t.paidAt && <span>{new Date(t.paidAt).toLocaleDateString()}</span>}
                          <button
                            onClick={() => onRevert(t)}
                            className="text-gray-500 hover:text-gray-300 transition-colors"
                          >
                            Revert
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

/** Monthly transfer split by destination account. */
export function TransferByAccount({ breakdown, fmt }: { breakdown: TransferBreakdown | undefined; fmt: Fmt }) {
  if (!breakdown || breakdown.byAccount.length === 0) return null
  return (
    <div className="flex flex-col">
      <h2 className="font-mono text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">Transfer by account</h2>
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {breakdown.byAccount.map((a) => (
              <tr key={a.accountId ?? '__untagged__'} className="border-b border-gray-800 last:border-0">
                <td className="px-4 py-3 text-white">
                  {a.accountName}
                  {a.accountType && (
                    <span className="ml-2 text-xs text-gray-500">{a.accountType.replace('_', ' ')}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                  {fmt(a.monthlyAmount)}<span className="text-gray-600 text-xs">/mo</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

interface MarkPaidDialogProps {
  transfer: BudgetTransfer
  amount: string
  setAmount: (v: string) => void
  loading: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Dialog for recording the actually transferred amount. Kept as its own overlay
 * (no Escape/backdrop close, no X button) rather than components/Modal so it
 * looks and behaves exactly as before.
 */
export function MarkPaidDialog({ transfer: markPaidTransfer, amount: markPaidAmount, setAmount, loading: markPaidLoading, onConfirm, onClose }: MarkPaidDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:px-4">
      <div role="dialog" aria-modal="true" className="bg-gray-900 border border-gray-700 border-b-0 sm:border-b rounded-t-2xl sm:rounded-xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 w-full sm:max-w-sm motion-safe:animate-sheet-up sm:motion-safe:animate-none">
        <h3 className="text-lg font-semibold text-white mb-1">Mark Transfer as Paid</h3>
        <p className="text-gray-400 text-sm mb-4">
          {MONTH_NAMES[(markPaidTransfer.month - 1) % 12]} {markPaidTransfer.year}
        </p>
        <label className="block font-mono text-[11px] text-gray-400 uppercase tracking-widest mb-1">
          Actual amount transferred
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={markPaidAmount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-amber-500"
        />
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={markPaidLoading || !markPaidAmount}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-950 font-medium text-sm py-2 rounded-lg transition-colors"
          >
            {markPaidLoading ? 'Saving…' : 'Confirm'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
