import { AlertTriangle, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { PageLoader } from '../../components/LoadingSpinner'
import { receiptStatusClass } from './helpers'
import type { ReceiptSummary } from './types'

interface ReceiptHistoryListProps {
  receipts: ReceiptSummary[]
  isLoading: boolean
  /** Expanded list vs. a narrow strip of status dots. */
  isOpen: boolean
  onToggle: () => void
  selectedId: string | null
  onSelect: (receiptId: string) => void
  fmt: (value: number | string) => string
}

/** The receipt sidebar: drafts first, then confirmed receipts. */
export function ReceiptHistoryList({ receipts, isLoading, isOpen, onToggle, selectedId, onSelect, fmt }: ReceiptHistoryListProps) {
  const draftReceipts = receipts.filter((receipt) => receipt.status === 'DRAFT')
  const confirmedReceipts = receipts.filter((receipt) => receipt.status === 'CONFIRMED')
  const allReceipts = [...draftReceipts, ...confirmedReceipts]

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden xl:sticky xl:top-5">
      <div className={`border-b border-gray-800 flex items-center gap-2 ${isOpen ? 'px-3 py-3 justify-between' : 'p-2 justify-center'}`}>
        {isOpen && <h2 className="font-semibold text-sm">Receipt history</h2>}
        <button
          type="button"
          onClick={onToggle}
          className="h-9 w-9 shrink-0 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 inline-flex items-center justify-center"
          aria-label={isOpen ? 'Collapse receipt history' : 'Expand receipt history'}
        >
          {isOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {isLoading ? (
        <div className="min-h-24"><PageLoader /></div>
      ) : receipts.length === 0 ? (
        <p className={`${isOpen ? 'p-4' : 'sr-only'} text-sm text-gray-500`}>No receipts imported yet.</p>
      ) : (
        <div className="divide-y divide-gray-800 max-h-[calc(100vh-190px)] overflow-y-auto">
          {allReceipts.map((receipt) => {
            const isSelected = selectedId === receipt.id
            return (
              <button
                key={receipt.id}
                onClick={() => onSelect(receipt.id)}
                className={`w-full text-left hover:bg-gray-800/60 transition-colors ${isSelected ? 'bg-gray-800' : ''} ${isOpen ? 'px-3 py-3' : 'p-2'}`}
                title={receipt.merchantName || 'Unknown merchant'}
              >
                {isOpen ? (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{receipt.merchantName || 'Unknown merchant'}</p>
                        <p className="text-xs text-gray-500">{receipt.purchaseDate ?? 'No date'} · {receipt.itemCount} items</p>
                      </div>
                      <span className={`text-[10px] border rounded-full px-2 py-0.5 shrink-0 ${receiptStatusClass(receipt.status)}`}>
                        {receipt.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        {fmt(receipt.itemTotal)}
                        {receipt.totalMismatch && (
                          <span className="text-amber-300" title="Line items don't add up to the printed total">
                            <AlertTriangle size={12} aria-hidden="true" />
                            <span className="sr-only">Line items don't add up to the printed total</span>
                          </span>
                        )}
                      </span>
                      {receipt.lowConfidenceCount > 0 && <span className="text-amber-300">{receipt.lowConfidenceCount} to review</span>}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className={`h-3 w-3 rounded-full ${receipt.status === 'CONFIRMED' ? 'bg-green-400' : 'bg-amber-400'}`} />
                    {receipt.lowConfidenceCount > 0 && <span className="text-[10px] text-amber-300">{receipt.lowConfidenceCount}</span>}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
