import type { Dispatch, SetStateAction } from 'react'
import { Plus } from 'lucide-react'
import type { Category } from '../../api/types'
import { primaryBtn } from '../../lib/styles'
import { compactInputClass } from './helpers'
import type { LineDraft, ReceiptSubcategory } from './types'

interface ManualLineFormProps {
  draft: LineDraft
  setDraft: Dispatch<SetStateAction<LineDraft>>
  categories: Category[]
  subcategories: ReceiptSubcategory[]
  onSubmit: () => void
  isPending: boolean
}

/** Adds a line the parser missed to a draft receipt. */
export function ManualLineForm({ draft, setDraft, categories, subcategories, onSubmit, isPending }: ManualLineFormProps) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_auto] gap-2 border border-gray-800 rounded-xl p-3"
    >
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Item</span>
        <input
          value={draft.label}
          onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value, originalText: e.target.value }))}
          className={compactInputClass}
          placeholder="Manual line item"
        />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Qty</span>
        <input
          type="number"
          step="0.001"
          value={draft.quantity}
          onChange={(e) => setDraft((prev) => ({ ...prev, quantity: e.target.value }))}
          className={compactInputClass}
        />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Amount</span>
        <input
          type="number"
          step="0.01"
          value={draft.amount}
          onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
          className={compactInputClass}
        />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Category</span>
        <select
          value={draft.categoryId}
          onChange={(e) => setDraft((prev) => ({ ...prev, categoryId: e.target.value, subcategoryId: '' }))}
          className={compactInputClass}
        >
          <option value="">Uncategorized</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Subcategory</span>
        <select
          value={draft.subcategoryId}
          onChange={(e) => setDraft((prev) => ({ ...prev, subcategoryId: e.target.value }))}
          className={compactInputClass}
          disabled={!draft.categoryId}
        >
          <option value="">No subcategory</option>
          {subcategories
            .filter((subcategory) => subcategory.categoryId === draft.categoryId)
            .map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
        </select>
      </label>
      <div className="flex items-end md:col-span-2 2xl:col-span-1">
        <button type="submit" disabled={isPending} className={`${primaryBtn} w-full flex items-center justify-center gap-2`}>
          <Plus size={16} />
          Add line
        </button>
      </div>
    </form>
  )
}
