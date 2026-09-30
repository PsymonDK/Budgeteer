import type { FormEvent } from 'react'
import type { AccountInfo, Category, Currency, HouseholdMember } from '../../api/types'
import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { AccountSelect } from '../../components/AccountSelect'
import { OwnershipFields } from '../../components/OwnershipFields'
import { EntryAmountFields } from '../../components/entries/EntryAmountFields'
import { DueDayField } from '../../components/entries/DueDayField'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { MONTH_OPTIONS } from './helpers'
import type { ExpenseForm } from './types'
import { StickyActions } from '../../components/StickyActions'

interface ExpenseFormModalProps {
  isEditing: boolean
  form: ExpenseForm
  setForm: (form: ExpenseForm) => void
  error: string
  pending: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  categories: Category[]
  currencies: Currency[]
  baseCurrency: string
  members: HouseholdMember[]
  hasAccounts: boolean
  personalAccounts: AccountInfo[]
  householdAccounts: AccountInfo[]
  fmt: (v: number | string, suffix?: string) => string
}

/** New / edit expense dialog. */
export function ExpenseFormModal({
  isEditing, form, setForm, error, pending, onSubmit, onClose, categories, currencies, baseCurrency,
  members, hasAccounts, personalAccounts, householdAccounts, fmt,
}: ExpenseFormModalProps) {
  return (
    <Modal
      title={isEditing ? 'Edit expense' : 'New expense'}
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
              placeholder="e.g. Rent"
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

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              required
              className={inputClass}
            >
              <option value="">Select a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.isSystemWide ? '' : ' (custom)'}</option>
              ))}
            </select>
          </div>
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
              Frequency period <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              value={form.frequencyPeriod}
              onChange={(e) => setForm({ ...form, frequencyPeriod: e.target.value })}
              placeholder="e.g. month 1 of quarter"
              className={inputClass}
            />
          </div>
          <DueDayField
            value={form.dueDay}
            frequency={form.frequency}
            onChange={(dueDay) => setForm({ ...form, dueDay })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Active from <span className="text-gray-600">(optional)</span>
              </label>
              <select
                value={form.startMonth}
                onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
                className={inputClass}
              >
                <option value="">Start of year</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Active until <span className="text-gray-600">(optional)</span>
              </label>
              <select
                value={form.endMonth}
                onChange={(e) => setForm({ ...form, endMonth: e.target.value })}
                className={inputClass}
              >
                <option value="">End of year</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
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
              {pending ? 'Saving…' : isEditing ? 'Save changes' : 'Add expense'}
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
