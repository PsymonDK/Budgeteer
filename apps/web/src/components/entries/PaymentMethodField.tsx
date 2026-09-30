import type { PaymentMethod } from '../../api/types'
import { segmentBtnSolid, segmentGroupPlain } from '../../lib/styles'

const OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'MANUAL', label: 'Manual' },
]

/** How an expense or savings entry is paid: automatically, or by hand (listed as a reminder to tick off). */
export function PaymentMethodField({ value, onChange }: { value: PaymentMethod; onChange: (value: PaymentMethod) => void }) {
  return (
    <div>
      <p id="payment-method-label" className="block text-xs font-medium text-gray-400 mb-1">How it's paid</p>
      <div role="radiogroup" aria-labelledby="payment-method-label" aria-describedby="payment-method-help" className={segmentGroupPlain}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={segmentBtnSolid(value === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p id="payment-method-help" className="text-xs text-gray-500 mt-1">
        {value === 'AUTOMATIC'
          ? 'Goes out on its own: direct debit, standing order or card.'
          : 'You pay it yourself. Pay/No-pay households get it on the monthly list to tick off.'}
      </p>
    </div>
  )
}

/** "Manual" badge next to an entry's label; automatic entries (the usual case) get none. */
export function ManualBadge({ paymentMethod }: { paymentMethod: PaymentMethod }) {
  if (paymentMethod !== 'MANUAL') return null
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border border-gray-600 text-gray-300" title="Paid by hand">
      Manual
    </span>
  )
}
