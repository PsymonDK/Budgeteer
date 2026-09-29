import type { AccountInfo } from '../../api/types'
import { compactInputClass } from './helpers'
import type { HeaderDraft } from './types'

interface ReceiptHeaderFormProps {
  draft: HeaderDraft
  onChange: (patch: Partial<HeaderDraft>) => void
  onSubmit: () => void
  baseCurrency: string
  currencyOptions: { code: string; name: string }[]
  accountOptions: AccountInfo[]
}

/** Merchant, date, currency, printed total, tax/fees and account of the receipt under review. */
export function ReceiptHeaderForm({ draft, onChange, onSubmit, baseCurrency, currencyOptions, accountOptions }: ReceiptHeaderFormProps) {
  const base = baseCurrency || 'DKK'
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 border border-gray-800 rounded-xl p-3"
    >
      <label className="min-w-0 xl:col-span-2">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Merchant</span>
        <input value={draft.merchantName} onChange={(e) => onChange({ merchantName: e.target.value })} className={compactInputClass} />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Purchase date</span>
        <input type="date" value={draft.purchaseDate} onChange={(e) => onChange({ purchaseDate: e.target.value })} className={compactInputClass} />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Currency</span>
        <select value={draft.currencyCode || base} onChange={(e) => onChange({ currencyCode: e.target.value })} className={compactInputClass}>
          {currencyOptions.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code === base ? `${currency.code} (base)` : `${currency.code} - ${currency.name}`}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Printed total</span>
        <input
          type="number"
          step="0.01"
          value={draft.printedTotal}
          onChange={(e) => onChange({ printedTotal: e.target.value })}
          className={compactInputClass}
        />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Tax</span>
        <input type="number" step="0.01" value={draft.taxAmount} onChange={(e) => onChange({ taxAmount: e.target.value })} className={compactInputClass} />
      </label>
      <label className="min-w-0">
        <span className="block text-xs font-medium text-gray-400 mb-1.5">Fees</span>
        <input type="number" step="0.01" value={draft.feeAmount} onChange={(e) => onChange({ feeAmount: e.target.value })} className={compactInputClass} />
      </label>
      {accountOptions.length > 0 && (
        <label className="min-w-0 md:col-span-2 xl:col-span-1">
          <span className="block text-xs font-medium text-gray-400 mb-1.5">Account</span>
          <select value={draft.accountId} onChange={(e) => onChange({ accountId: e.target.value })} className={compactInputClass}>
            <option value="">No account</option>
            {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
      )}
    </form>
  )
}
