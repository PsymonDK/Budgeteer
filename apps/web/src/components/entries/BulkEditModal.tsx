import type { FormEvent } from 'react'
import type { AccountInfo, Category, PaymentMethod } from '../../api/types'
import { Modal } from '../Modal'
import { FormError } from '../FormError'
import { AccountSelect } from '../AccountSelect'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { StickyActions } from '../StickyActions'

export interface BulkEditForm {
  categoryId: string
  accountId: string
  /** '' = unchanged */
  paymentMethod: '' | PaymentMethod
}

export const emptyBulkForm = (): BulkEditForm => ({ categoryId: '', accountId: '', paymentMethod: '' })

interface BulkEditModalProps {
  title: string
  form: BulkEditForm
  setForm: (form: BulkEditForm) => void
  categories: Pick<Category, 'id' | 'name' | 'isSystemWide'>[]
  /** Show the category field (savings hides it when there are no savings categories). */
  showCategory: boolean
  /** Offer "None (clear category)" (savings entries may be uncategorised). */
  allowClearCategory: boolean
  hasAccounts: boolean
  personalAccounts: AccountInfo[]
  householdAccounts: AccountInfo[]
  error: string
  pending: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}

/** Change the category, account and/or payment method of the selected expenses or savings entries. */
export function BulkEditModal({
  title, form, setForm, categories, showCategory, allowClearCategory, hasAccounts,
  personalAccounts, householdAccounts, error, pending, onSubmit, onClose,
}: BulkEditModalProps) {
  return (
    <Modal title={title} onClose={onClose} size="sm">
      <p className="text-xs text-gray-500 mb-4">Only fields you change will be updated. Leave a field as "— unchanged —" to keep existing values.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        {showCategory && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className={inputClass}
            >
              <option value="">— unchanged —</option>
              {allowClearCategory && <option value="__none__">None (clear category)</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
              ))}
            </select>
          </div>
        )}
        {hasAccounts && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Account</label>
            <AccountSelect
              value={form.accountId}
              onChange={(v) => setForm({ ...form, accountId: v })}
              personal={personalAccounts}
              household={householdAccounts}
            >
              <option value="">— unchanged —</option>
              <option value="__none__">None (clear account)</option>
            </AccountSelect>
          </div>
        )}
        <div>
          <label htmlFor="bulk-payment-method" className="block text-xs font-medium text-gray-400 mb-1">How it's paid</label>
          <select
            id="bulk-payment-method"
            value={form.paymentMethod}
            onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as BulkEditForm['paymentMethod'] })}
            className={inputClass}
          >
            <option value="">— unchanged —</option>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>
        <FormError message={error} />
        <StickyActions>
          <button
            type="submit"
            disabled={pending}
            className={`flex-1 ${primaryBtn}`}
          >
            {pending ? 'Saving…' : 'Apply changes'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </StickyActions>
      </form>
    </Modal>
  )
}
