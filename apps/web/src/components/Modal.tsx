import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const sizeClass = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-5xl',
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

/**
 * Dialog. On phones (< 640px) it is a bottom sheet: full width, anchored to the bottom edge, with the
 * title bar pinned while the content scrolls. From 640px it is a centred dialog. The dialog is a
 * container, so form grids inside can use `@sm:` / `@md:` to add columns only when there is room.
 */
export function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Where focus was before opening — read during the first render, before an autoFocus field inside takes it
  const [returnFocusTo] = useState(() => document.activeElement as HTMLElement | null)

  // Move focus into the dialog (unless a field inside already took it) and give it back on close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog?.contains(document.activeElement)) dialog?.focus()
    // Only once the dialog has really left the page (not on StrictMode's simulated unmount)
    return () => queueMicrotask(() => { if (!dialog?.isConnected) returnFocusTo?.focus?.() })
  }, [returnFocusTo])

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center sm:p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`@container bg-gray-900 border border-gray-800 border-b-0 sm:border-b rounded-t-2xl sm:rounded-xl w-full ${sizeClass[size]} max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain px-4 sm:px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6 focus:outline-none motion-safe:animate-sheet-up sm:motion-safe:animate-none`}
      >
        <div className="sticky top-0 z-10 bg-gray-900 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2 sm:pt-6 pb-4 mb-1">
          {/* Grab handle: shows it's a sheet on phones */}
          <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-700" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="p-1 -m-1 text-gray-500 hover:text-white transition-colors" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
