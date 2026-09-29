import type { Category } from '../../api/types'
import { compactInputClass, draftNeedsReview, lineActionBtn, lineToDraft } from './helpers'
import type { LineDraft, ReceiptConfidence, ReceiptLineItem, ReceiptSubcategory } from './types'

const ROW_GRID = '2xl:grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_96px_104px]'

interface LineItemsTableProps {
  /** All line items of the receipt (for the empty state). */
  lineItems: ReceiptLineItem[]
  /** The rows to render (all, or only those needing review). */
  visibleItems: ReceiptLineItem[]
  drafts: Record<string, LineDraft>
  categories: Category[]
  subcategories: ReceiptSubcategory[]
  onChange: (itemId: string, patch: Partial<LineDraft>) => void
  onSave: (itemId: string) => void
  newSubcategoryName: Record<string, string>
  onNewSubcategoryNameChange: (itemId: string, name: string) => void
  onAddSubcategory: (itemId: string, categoryId: string) => void
}

/** Editable grid of the receipt's line items. */
export function LineItemsTable({
  lineItems, visibleItems, drafts, categories, subcategories, onChange, onSave,
  newSubcategoryName, onNewSubcategoryNameChange, onAddSubcategory,
}: LineItemsTableProps) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="hidden 2xl:grid grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_96px_104px] gap-2 px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400">
        <span>Item</span>
        <span>Qty</span>
        <span>Amount</span>
        <span>Category</span>
        <span>Subcategory</span>
        <span>Confidence</span>
        <span>Actions</span>
      </div>
      <div className="divide-y divide-gray-800">
        {lineItems.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-500">No line items detected. Add receipt lines manually above.</p>
        ) : visibleItems.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-500">No lines need review.</p>
        ) : visibleItems.map((item) => {
          const draft = drafts[item.id] ?? lineToDraft(item)
          const needsReview = draftNeedsReview(draft)
          const update = (patch: Partial<LineDraft>) => onChange(item.id, patch)
          return (
            <div key={item.id} className={`grid grid-cols-1 md:grid-cols-2 ${ROW_GRID} gap-2 p-3 ${draft.isIgnored ? 'opacity-50' : ''}`}>
              <label className="min-w-0 md:col-span-2 2xl:col-span-1">
                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Item</span>
                <input value={draft.label} onChange={(e) => update({ label: e.target.value })} className={compactInputClass} />
                {needsReview && <p className="mt-1 text-xs text-amber-300">Needs review</p>}
              </label>
              <label className="min-w-0">
                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Qty</span>
                <input type="number" step="0.001" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} className={compactInputClass} />
              </label>
              <label className="min-w-0">
                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Amount</span>
                <input type="number" step="0.01" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} className={compactInputClass} />
              </label>
              <label className="min-w-0">
                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Category</span>
                <select
                  value={draft.categoryId}
                  onChange={(e) => update({ categoryId: e.target.value, subcategoryId: '' })}
                  className={compactInputClass}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <div className="min-w-0">
                <label>
                  <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Subcategory</span>
                  <select
                    value={draft.subcategoryId}
                    onChange={(e) => update({ subcategoryId: e.target.value })}
                    className={compactInputClass}
                    disabled={!draft.categoryId}
                  >
                    <option value="">No subcategory</option>
                    {subcategories
                      .filter((subcategory) => subcategory.categoryId === draft.categoryId)
                      .map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                  </select>
                </label>
                {draft.categoryId && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newSubcategoryName[item.id] ?? ''}
                      onChange={(e) => onNewSubcategoryNameChange(item.id, e.target.value)}
                      placeholder="New subcategory"
                      className={`${compactInputClass} py-1.5`}
                    />
                    <button
                      type="button"
                      onClick={() => onAddSubcategory(item.id, draft.categoryId)}
                      className={`${lineActionBtn} whitespace-nowrap`}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
              <label className="min-w-0">
                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Confidence</span>
                <select value={draft.confidence} onChange={(e) => update({ confidence: e.target.value as ReceiptConfidence })} className={compactInputClass}>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </label>
              <div className="flex items-end gap-2 md:col-span-2 2xl:col-span-1">
                <button onClick={() => onSave(item.id)} className={`flex-1 ${lineActionBtn}`} type="button">Save</button>
                <button
                  onClick={() => update({ isIgnored: !draft.isIgnored })}
                  className={`flex-1 ${lineActionBtn}`}
                  type="button"
                >
                  {draft.isIgnored ? 'Use' : 'Ignore'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
