import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { dangerBtn, secondaryBtn } from '../lib/styles'

interface ConfirmDialogProps {
  title: string
  /** Closes the dialog: Escape, backdrop, the X button and Cancel. */
  onClose: () => void
  onConfirm: () => void
  /** Confirm button content, e.g. `pending ? 'Deleting…' : 'Delete'`. */
  confirmLabel: ReactNode
  /** Confirm button style; defaults to the destructive red button. */
  confirmClassName?: string
  /** Disables the confirm button while the action runs. */
  pending?: boolean
  /** Message paragraphs (and an optional <FormError>) shown above the buttons. */
  children: ReactNode
}

/** A small confirm/cancel dialog built on Modal. */
export function ConfirmDialog({
  title, onClose, onConfirm, confirmLabel, confirmClassName = dangerBtn, pending, children,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose} size="sm">
      {children}
      <div className="flex gap-3">
        <button onClick={onConfirm} disabled={pending} className={`flex-1 ${confirmClassName}`}>
          {confirmLabel}
        </button>
        <button onClick={onClose} className={`flex-1 ${secondaryBtn}`}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
