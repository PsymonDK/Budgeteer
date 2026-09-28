import { errorBox, errorBoxSm } from '../lib/styles'

interface FormErrorProps {
  /** Nothing renders while this is empty. */
  message?: string | null
  /** Extra classes, e.g. spacing (`mb-4`). */
  className?: string
  size?: 'md' | 'sm'
}

/** The red inline error box shown under forms and in confirm dialogs. */
export function FormError({ message, className, size = 'md' }: FormErrorProps) {
  if (!message) return null
  const base = size === 'sm' ? errorBoxSm : errorBox
  return <div className={className ? `${base} ${className}` : base}>{message}</div>
}
