import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TriangleAlert, Check, Trash } from 'lucide-react'
import { useCategories, useCurrencies, useHouseholdAccounts, usePersonalAccounts } from '../../api/queries'
import { useBaseCurrency, useFmt } from '../../hooks/useFmt'
import { dangerBtn, primaryBtn, secondaryBtn } from '../../lib/styles'
import { CONFIDENCE_CLASS, buildCurrencyOptions, draftNeedsReview, lineToDraft, receiptStatusClass } from './helpers'
import { useReceiptEditor } from './useReceiptEditor'
import { ReceiptPreview } from './ReceiptPreview'
import { ReceiptHeaderForm } from './ReceiptHeaderForm'
import { ManualLineForm } from './ManualLineForm'
import { LineItemsTable } from './LineItemsTable'
import { useReceiptSubcategories } from './queries'
import type { Receipt, ReceiptConfidence } from './types'

interface ReceiptReviewProps {
  householdId: string
  receipt: Receipt
  onDeleted: (receiptId: string) => void
}

/** Review/editor pane of one receipt: header details, line items, confirm and delete. */
export function ReceiptReview({ householdId, receipt, onDeleted }: ReceiptReviewProps) {
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [showReviewOnly, setShowReviewOnly] = useState(false)
  const [showParserNotes, setShowParserNotes] = useState(false)
  const editor = useReceiptEditor(householdId, receipt, onDeleted)
  const { headerDraft, lineDrafts } = editor

  const { data: categories = [] } = useCategories(householdId, 'EXPENSE')
  const { data: subcategories = [] } = useReceiptSubcategories(householdId)
  const { data: personalAccounts = [] } = usePersonalAccounts()
  const { data: householdAccounts = [] } = useHouseholdAccounts(householdId)
  const accountOptions = [...personalAccounts, ...householdAccounts].filter((a) => a.isActive || a.id === receipt.accountId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { data: currencies = [] } = useCurrencies()

  const currencyOptions = useMemo(
    () => buildCurrencyOptions(baseCurrency, currencies, headerDraft.currencyCode),
    [baseCurrency, currencies, headerDraft.currencyCode],
  )

  // Live preview of the edited lines; the saved total is computed server-side.
  const itemsTotal = useMemo(() => receipt.lineItems
    .filter((item) => !lineDrafts[item.id]?.isIgnored)
    .reduce((sum, item) => sum + (parseFloat(lineDrafts[item.id]?.amount ?? item.amount) || 0), 0),
  [receipt, lineDrafts])

  const reviewItems = useMemo(
    () => receipt.lineItems.filter((item) => draftNeedsReview(lineDrafts[item.id] ?? lineToDraft(item))),
    [receipt, lineDrafts],
  )
  const reviewLineCount = reviewItems.length
  const visibleLineItems = showReviewOnly ? reviewItems : receipt.lineItems

  return (
    <div className="min-w-0">
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900/95 backdrop-blur px-4 py-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold truncate">{receipt.merchantName || 'Receipt review'}</h2>
              <ConfidenceBadge confidence={receipt.confidence} />
              <span className={`text-xs border rounded-full px-2 py-1 ${receiptStatusClass(receipt.status)}`}>
                {receipt.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {receipt.purchaseDate ?? 'No date'} · {receipt.lineItems.length} lines · Total {fmt(itemsTotal.toFixed(2), receipt.currencyCode)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => editor.saveHeaderMutation.mutate()}
              disabled={editor.saveHeaderMutation.isPending}
              className={secondaryBtn}
            >
              {editor.saveHeaderMutation.isPending ? 'Saving...' : 'Save details'}
            </button>
            {receipt.status !== 'CONFIRMED' && (
              <button onClick={() => editor.confirmMutation.mutate()} disabled={editor.confirmMutation.isPending} className={`${primaryBtn} flex items-center gap-2`}>
                <Check size={16} />
                Confirm
              </button>
            )}
            <button onClick={() => setConfirmingDelete(true)} className={`${dangerBtn} flex items-center gap-2`}>
              <Trash size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete receipt?"
          confirmLabel="Delete"
          pending={editor.deleteMutation.isPending}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => editor.deleteMutation.mutate(receipt.id, { onSettled: () => setConfirmingDelete(false) })}
        >
          <p className="text-sm text-gray-400 mb-6">
            {receipt.merchantName ?? 'This receipt'} and its line items will be removed from receipts and consumption totals.
          </p>
        </ConfirmDialog>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-4 p-4 min-w-0">
        <ReceiptPreview householdId={householdId} receipt={receipt} />

        <div className="min-w-0 space-y-4">
          {receipt.notes?.length > 0 && (
            <div className="border border-amber-800/60 bg-amber-900/20 rounded-lg text-sm text-amber-200">
              <button
                type="button"
                onClick={() => setShowParserNotes((show) => !show)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2 font-medium"><TriangleAlert size={16} /> Parser notes</span>
                <span className="text-xs text-amber-300">{showParserNotes ? 'Hide' : `${receipt.notes.length} notes`}</span>
              </button>
              {showParserNotes && (
                <ul className="px-4 pb-3 list-disc list-inside space-y-1">
                  {receipt.notes.map((note, index) => <li key={index}>{note}</li>)}
                </ul>
              )}
            </div>
          )}

          {receipt.totalMismatch && receipt.printedTotal != null && (
            <p className="flex gap-2 border border-amber-800/60 bg-amber-900/20 rounded-lg px-3 py-2 text-sm text-amber-200">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              Line items add up to {fmt(receipt.totalAmount ?? '0', receipt.currencyCode)}, the receipt says {fmt(receipt.printedTotal, receipt.currencyCode)} — check for missed or misread lines.
            </p>
          )}

          <ReceiptHeaderForm
            draft={headerDraft}
            onChange={editor.updateHeaderDraft}
            onSubmit={() => editor.saveHeaderMutation.mutate()}
            baseCurrency={baseCurrency}
            currencyOptions={currencyOptions}
            accountOptions={accountOptions}
          />

          {receipt.status !== 'CONFIRMED' && (
            <ManualLineForm
              draft={editor.manualLineDraft}
              setDraft={editor.setManualLineDraft}
              categories={categories}
              subcategories={subcategories}
              onSubmit={() => editor.createLineMutation.mutate()}
              isPending={editor.createLineMutation.isPending}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-400">
              {reviewLineCount === 0 ? 'All detected lines have a category suggestion.' : `${reviewLineCount} ${reviewLineCount === 1 ? 'line needs' : 'lines need'} review.`}
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={showReviewOnly}
                onChange={(e) => setShowReviewOnly(e.target.checked)}
                className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-amber-400 focus:ring-amber-400"
              />
              Show only lines needing review
            </label>
          </div>

          <LineItemsTable
            lineItems={receipt.lineItems}
            visibleItems={visibleLineItems}
            drafts={lineDrafts}
            categories={categories}
            subcategories={subcategories}
            onChange={editor.updateLineDraft}
            onSave={(itemId) => editor.saveLineMutation.mutate(itemId)}
            newSubcategoryName={editor.newSubcategoryName}
            onNewSubcategoryNameChange={(itemId, name) => editor.setNewSubcategoryName((prev) => ({ ...prev, [itemId]: name }))}
            onAddSubcategory={editor.addSubcategory}
          />
        </div>
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: ReceiptConfidence }) {
  return <span className={`text-xs border rounded-full px-2 py-1 ${CONFIDENCE_CLASS[confidence]}`}>{confidence.toLowerCase()}</span>
}
