import type { FormEvent } from 'react'
import type { Account, AccountForm } from '../../api/types'
import { type AccountType, ACCOUNT_TYPE_LABELS } from '../../lib/constants'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { Modal } from '../Modal'
import { ConfirmDialog } from '../ConfirmDialog'
import { FormError } from '../FormError'

interface AccountFormModalProps {
  isEditing: boolean
  form: AccountForm
  setForm: (form: AccountForm) => void
  error: string
  pending: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  placeholder: string
  /** Field label style (the household settings page uses larger labels than the profile page). */
  labelClassName: string
  /** Button row style. */
  actionsClassName: string
}

/** Add / edit a personal or household account (name + type). */
export function AccountFormModal({
  isEditing, form, setForm, error, pending, onSubmit, onClose, placeholder, labelClassName, actionsClassName,
}: AccountFormModalProps) {
  return (
    <Modal
      title={isEditing ? 'Edit account' : 'Add account'}
      onClose={onClose}
      size="sm"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={labelClassName}>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={placeholder}
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className={labelClassName}>Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
            className={inputClass}
          >
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <FormError message={error} />
        <div className={actionsClassName}>
          <button
            type="submit"
            disabled={pending}
            className={`flex-1 ${primaryBtn}`}
          >
            {pending ? 'Saving…' : isEditing ? 'Save changes' : 'Add account'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface DeleteAccountDialogProps {
  account: Account
  error: string
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Delete confirmation that warns when the account still has entries. */
export function DeleteAccountDialog({ account, error, pending, onConfirm, onClose }: DeleteAccountDialogProps) {
  return (
    <ConfirmDialog
      title="Delete account"
      onClose={onClose}
      onConfirm={onConfirm}
      pending={pending}
      confirmLabel={pending ? 'Deleting…' : 'Delete'}
    >
      <p className="text-gray-300 text-sm mb-2">
        Delete <span className="font-semibold text-white">"{account.name}"</span>?
      </p>
      {account._count.expenses > 0 || account._count.savingsEntries > 0 ? (
        <p className="text-amber-400 text-xs mb-4">
          This account has {account._count.expenses + account._count.savingsEntries} associated entries.
          Remove them before deleting, or deactivate the account instead.
        </p>
      ) : (
        <p className="text-gray-500 text-xs mb-4">This action cannot be undone.</p>
      )}
      <FormError message={error} size="sm" className="mb-4" />
    </ConfirmDialog>
  )
}
