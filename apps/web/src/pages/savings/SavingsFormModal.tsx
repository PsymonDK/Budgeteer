import type { FormEvent } from 'react'
import type { AccountInfo, Category, Currency, HouseholdMember } from '../../api/types'
import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { AccountSelect } from '../../components/AccountSelect'
import { OwnershipFields } from '../../components/OwnershipFields'
import { EntryAmountFields } from '../../components/entries/EntryAmountFields'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import type { EntryForm } from './types'
import { StickyActions } from '../../components/StickyActions'

interface SavingsFormModalProps {
  isEditing: boolean
  form: EntryForm
  setForm: (form: EntryForm) => void
  error: string
  pending: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  savingsCategories: Category[]
  currencies: Currency[]
  baseCurrency: string
  members: HouseholdMember[]
  hasAccounts: boolean
  personalAccounts: AccountInfo[]
  householdAccounts: AccountInfo[]
  fmt: (v: number | string, suffix?: string) => string
}

/** New / edit savings entry dialog. */
export function SavingsFormModal({
  isEditing, form, setForm, error, pending, onSubmit, onClose, savingsCategories, currencies, baseCurrency,
  members, hasAccounts, personalAccounts, householdAccounts, fmt,
}: SavingsFormModalProps) {
  return (
    <Modal
      title={isEditing ? 'Edit savings entry' : 'New savings entry'}
      onClose={onClose}
      size="lg"
    >
      {/* The Modal scrolls; no inner scroll box, so the Save bar sticks to the sheet edge */}
      <>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              required
              autoFocus
              placeholder="e.g. Emergency fund"
              className={inputClass}
            />
          </div>

          <EntryAmountFields
            value={form}
            onChange={(patch) => setForm({ ...form, ...patch })}
            currencies={currencies}
            baseCurrency={baseCurrency}
            fmt={fmt}
          />

          {savingsCategories.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Category <span className="text-gray-600">(optional)</span>
              </label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className={inputClass}
              >
                <option value="">No category</option>
                {savingsCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
                ))}
              </select>
            </div>
          )}

          {hasAccounts && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Account <span className="text-gray-600">(optional)</span>
              </label>
              <AccountSelect
                value={form.accountId ?? ''}
                onChange={(v) => setForm({ ...form, accountId: v || null })}
                personal={personalAccounts}
                household={householdAccounts}
              >
                <option value="">— None —</option>
              </AccountSelect>
            </div>
          )}

          <OwnershipFields
            members={members}
            value={form}
            onChange={(next) => setForm({ ...form, ...next })}
          />

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Notes <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Any additional details…"
              className={inputClass + ' resize-none'}
            />
          </div>

          <FormError message={error} />
          <StickyActions>
            <button
              type="submit"
              disabled={pending}
              className={`flex-1 ${primaryBtn}`}
            >
              {pending ? 'Saving…' : isEditing ? 'Save changes' : 'Add savings'}
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
      </>
    </Modal>
  )
}
