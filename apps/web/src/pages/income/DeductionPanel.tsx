import { useState } from 'react'
import { r2, type LiveDeductions } from '../../lib/danishTaxPreview'
import type { DeductionOverrides } from './types'

function fmt2(n: number, cur: string) {
  return `${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
}

interface DeductionPanelProps {
  gross: number
  liveCalc: LiveDeductions | null
  overrides: DeductionOverrides
  onOverrideChange: (field: keyof DeductionOverrides, val: string) => void
  hasTaxCard: boolean
  baseCurrency: string
}

export function DeductionPanel({ gross, liveCalc, overrides, onOverrideChange, hasTaxCard, baseCurrency }: DeductionPanelProps) {
  const [editingField, setEditingField] = useState<keyof DeductionOverrides | null>(null)

  if (!hasTaxCard && !liveCalc) {
    return (
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4 text-sm text-gray-400">
        <p>Add tax card settings to enable auto-calculation of deductions.</p>
        <p className="mt-1 text-xs text-gray-500">You can still save a salary record; deductions will be stored as-is.</p>
      </div>
    )
  }

  if (!liveCalc || !gross) {
    return (
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4 text-sm text-gray-400">
        Enter a gross amount to see the deduction breakdown.
      </div>
    )
  }

  const hasManualOverride = Object.values(overrides).some((v) => v !== '')
  const displayNet = hasManualOverride
    ? r2(gross - liveCalc.bruttoTotal - (parseFloat(overrides.amBidragAmount) || liveCalc.amBidrag) - (parseFloat(overrides.aSkattAmount) || liveCalc.aSkat) - (parseFloat(overrides.pensionEmployeeAmount) || liveCalc.pensionEmployee) - (parseFloat(overrides.atpAmount) || liveCalc.atp))
    : liveCalc.net

  function DeductionRow({ label, field, calcValue }: { label: string; field: keyof DeductionOverrides; calcValue: number }) {
    const isManual = overrides[field] !== ''
    const displayVal = isManual ? (parseFloat(overrides[field]) || 0) : calcValue
    return (
      <div className="flex items-center justify-between py-1.5 border-b border-gray-700/50 last:border-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-300 text-sm">{label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${isManual ? 'bg-orange-900/50 text-orange-400 border border-orange-700' : 'bg-gray-700 text-gray-400'}`}>
            {isManual ? 'manual' : 'calc'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {editingField === field ? (
            <input
              type="number" step="0.01" autoFocus
              defaultValue={isManual ? overrides[field] : calcValue.toFixed(2)}
              onBlur={(e) => { onOverrideChange(field, e.target.value); setEditingField(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') { onOverrideChange(field, ''); setEditingField(null) } }}
              className="w-28 bg-gray-700 border border-amber-500 rounded px-2 py-0.5 text-white text-sm text-right focus:outline-none"
            />
          ) : (
            <>
              <span className="text-sm tabular-nums text-red-400">−{fmt2(displayVal, baseCurrency)}</span>
              <button type="button" onClick={() => setEditingField(field)} className="text-gray-500 hover:text-gray-300 text-xs" title="Override">✏</button>
              {isManual && (
                <button type="button" onClick={() => onOverrideChange(field, '')} className="text-gray-600 hover:text-gray-400 text-xs" title="Reset to calculated">↺</button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4 space-y-1">
      {liveCalc.bruttoTotal > 0 && (
        <div className="flex justify-between py-1.5 border-b border-gray-700/50 text-sm">
          <span className="text-purple-300">Brutto benefits</span>
          <span className="tabular-nums text-purple-400">−{fmt2(liveCalc.bruttoTotal, baseCurrency)}</span>
        </div>
      )}
      {liveCalc.bruttoTotal > 0 && (
        <div className="flex justify-between py-1 text-xs text-gray-500 border-b border-gray-700/50">
          <span>Taxable gross</span>
          <span className="tabular-nums">{fmt2(gross - liveCalc.bruttoTotal, baseCurrency)}</span>
        </div>
      )}
      <DeductionRow label="AM-bidrag (8%)" field="amBidragAmount" calcValue={liveCalc.amBidrag} />
      <DeductionRow label={`A-skat${liveCalc.topSkat > 0 ? ` (incl. top-skat ${fmt2(liveCalc.topSkat, baseCurrency)})` : ''}`} field="aSkattAmount" calcValue={liveCalc.aSkat} />
      {liveCalc.pensionEmployee > 0 && (
        <DeductionRow label="Employee pension" field="pensionEmployeeAmount" calcValue={liveCalc.pensionEmployee} />
      )}
      <DeductionRow label="ATP" field="atpAmount" calcValue={liveCalc.atp} />
      <div className="flex justify-between pt-2 border-t border-gray-600 font-semibold text-sm mt-1">
        <span className="text-white">Net pay</span>
        <span className="tabular-nums text-gray-100">{fmt2(displayNet, baseCurrency)}</span>
      </div>
      {liveCalc.pensionEmployer > 0 && (
        <div className="flex justify-between pt-1 text-xs text-gray-500">
          <span>Employer pension (not deducted)</span>
          <span className="tabular-nums">{fmt2(liveCalc.pensionEmployer, baseCurrency)}</span>
        </div>
      )}
      {hasManualOverride && (
        <button type="button" onClick={() => { onOverrideChange('amBidragAmount', ''); onOverrideChange('aSkattAmount', ''); onOverrideChange('pensionEmployeeAmount', ''); onOverrideChange('atpAmount', '') }}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1">Reset all to calculated</button>
      )}
    </div>
  )
}
