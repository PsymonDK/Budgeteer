import type { Currency } from '../../api/types'
import { FREQUENCIES, type Frequency, calcMonthly } from '../../lib/constants'
import { inputClass } from '../../lib/styles'

export interface EntryAmountValue {
  amount: string
  frequency: Frequency
  currencyCode: string
}

interface EntryAmountFieldsProps {
  value: EntryAmountValue
  onChange: (patch: Partial<EntryAmountValue>) => void
  currencies: Currency[]
  baseCurrency: string
  fmt: (v: number | string, suffix?: string) => string
}

/**
 * Amount + frequency, currency, and the live monthly-equivalent preview shared by
 * the expense and savings forms. The preview uses calcMonthly (preview only; the
 * API computes the stored monthlyEquivalent).
 */
export function EntryAmountFields({ value, onChange, currencies, baseCurrency, fmt }: EntryAmountFieldsProps) {
  const selectedCurrencyRate = currencies.find((c) => c.code === value.currencyCode)?.rate ?? 1
  const previewMonthly = value.amount && value.frequency
    ? calcMonthly((parseFloat(value.amount) || 0) * selectedCurrencyRate, value.frequency)
    : null
  const isForeignCurrency = value.currencyCode !== baseCurrency

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Amount</label>
          <input
            type="number"
            value={value.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            required
            min="0.01"
            step="0.01"
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Frequency</label>
          <select
            value={value.frequency}
            onChange={(e) => onChange({ frequency: e.target.value as Frequency })}
            className={inputClass}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {currencies.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
          <select
            value={value.currencyCode}
            onChange={(e) => onChange({ currencyCode: e.target.value })}
            className={inputClass}
          >
            <option value={baseCurrency}>{baseCurrency} (base)</option>
            {currencies.filter((c) => c.code !== baseCurrency).sort((a, b) => a.code.localeCompare(b.code)).map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </div>
      )}

      {previewMonthly !== null && (
        <p className="text-xs text-gray-500">
          Monthly equivalent:{' '}
          <span className="text-amber-400 font-medium">{fmt(previewMonthly)}</span>
          {isForeignCurrency && value.amount && (
            <span className="ml-2 text-gray-600">
              ({fmt(parseFloat(value.amount), value.currencyCode)} × {selectedCurrencyRate.toFixed(4)})
            </span>
          )}
        </p>
      )}
    </>
  )
}
