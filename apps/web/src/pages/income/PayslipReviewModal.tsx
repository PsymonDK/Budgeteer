import { useState } from 'react'
import type { PayslipExtraction, PayslipLine, PayslipLineType } from '../../lib/parsePayslipCsv'
import { Modal } from '../../components/Modal'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { MONTHS } from './helpers'
import { LINE_TYPE_LABELS, LINE_TYPE_SANKEY } from './payslipLineTypes'
import type { TaxCardDraft } from './types'

interface PayslipReviewModalProps {
  extraction: PayslipExtraction
  jobName: string
  onClose: () => void
  onConfirm: (data: PayslipExtraction, taxCard?: TaxCardDraft) => void
  isPending: boolean
}

export function PayslipReviewModal({ extraction, jobName, onClose, onConfirm, isPending }: PayslipReviewModalProps) {
  const [employer, setEmployer] = useState(extraction.employerName)
  const [year, setYear] = useState(extraction.period.year)
  const [month, setMonth] = useState(extraction.period.month)
  const [gross, setGross] = useState(extraction.grossSalary)
  const [net, setNet] = useState(extraction.netPay)
  const [pensionEmployer, setPensionEmployer] = useState(extraction.pensionEmployerMonthly ?? 0)
  const [lines, setLines] = useState<PayslipLine[]>(extraction.lines)

  // Tax card panel
  const [updateTaxCard, setUpdateTaxCard] = useState(false)
  const [traekprocent, setTraekprocent] = useState('')
  const [personfradrag, setPersonfradrag] = useState('3875')

  const cashDeductions = lines
    .filter((l) => l.type !== 'benefit_in_kind')
    .reduce((s, l) => s + l.amount, 0)
  const computedNet = Math.round((gross - cashDeductions) * 100) / 100
  const netDiff = Math.abs(computedNet - net)
  const netValid = netDiff <= 1

  // Derive pension percentages from payslip amounts (4 dp for accuracy)
  const round4 = (n: number) => Math.round(n * 10000) / 10000
  const pensionEmployeePct = gross > 0
    ? round4(lines.filter((l) => l.sankeyGroup === 'pension_employee').reduce((s, l) => s + l.amount, 0) / gross * 100)
    : 0
  const pensionEmployerPct = gross > 0 && pensionEmployer > 0
    ? round4(pensionEmployer / gross * 100)
    : 0
  const atpLine = lines.find((l) => l.sankeyGroup === 'atp')

  // Editable tax card derived fields (pre-filled, user can override)
  const [tcPensionEmployeePct, setTcPensionEmployeePct] = useState(() => pensionEmployeePct > 0 ? String(pensionEmployeePct) : '')
  const [tcPensionEmployerPct, setTcPensionEmployerPct] = useState(() => pensionEmployerPct > 0 ? String(pensionEmployerPct) : '')
  const [tcAtpAmount, setTcAtpAmount] = useState(() => atpLine ? String(atpLine.amount) : '')

  // Re-sync derived fields when gross or lines change (only if user hasn't customised)
  const effectiveFrom = `${year}-${String(month).padStart(2, '0')}-01`

  function updateLine(i: number, changes: Partial<PayslipLine>) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const updated = { ...l, ...changes }
      if (changes.type) updated.sankeyGroup = LINE_TYPE_SANKEY[changes.type] as PayslipLine['sankeyGroup']
      return updated
    }))
  }

  function deleteLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  function addLine() {
    setLines((prev) => [...prev, { label: '', amount: 0, type: 'post_tax', sankeyGroup: 'other_deductions', isCalculated: false }])
  }

  function handleConfirm() {
    const extractionData: PayslipExtraction = {
      ...extraction,
      period: { year, month },
      employerName: employer,
      grossSalary: gross,
      netPay: net,
      lines,
      pensionEmployerMonthly: pensionEmployer > 0 ? pensionEmployer : undefined,
    }

    let taxCard: TaxCardDraft | undefined
    if (updateTaxCard && traekprocent) {
      taxCard = {
        effectiveFrom,
        traekprocent: parseFloat(traekprocent),
        personfradragMonthly: parseFloat(personfradrag) || 3875,
        pensionEmployeePct: tcPensionEmployeePct ? parseFloat(tcPensionEmployeePct) : undefined,
        pensionEmployerPct: tcPensionEmployerPct ? parseFloat(tcPensionEmployerPct) : undefined,
        atpAmount: tcAtpAmount ? parseFloat(tcAtpAmount) : undefined,
      }
    }

    onConfirm(extractionData, taxCard)
  }

  return (
    <Modal title={`Review payslip — ${jobName}`} onClose={onClose} size="lg">
      <div className="space-y-5">
        {/* Period & employer */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || year)}
              min="2000" max="2100" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className={inputClass}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Employer
              {extraction.confidence !== 'high' && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${extraction.confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-red-900/50 text-red-300'}`}>
                  {extraction.confidence} confidence
                </span>
              )}
            </label>
            <input type="text" value={employer} onChange={(e) => setEmployer(e.target.value)} className={inputClass} />
          </div>
        </div>

        {/* Gross / net */}
        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
            <input type="number" value={gross} onChange={(e) => setGross(parseFloat(e.target.value) || 0)}
              min="0.01" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Net pay (to bank)
              <span className={`ml-2 text-xs ${netValid ? 'text-green-400' : 'text-amber-400'}`}>
                {netValid ? '✓ balanced' : `⚠ off by ${netDiff.toFixed(2)}`}
              </span>
            </label>
            <input type="number" value={net} onChange={(e) => setNet(parseFloat(e.target.value) || 0)}
              min="0.01" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Employer pension / month</label>
            <input type="number" value={pensionEmployer} onChange={(e) => setPensionEmployer(parseFloat(e.target.value) || 0)}
              min="0" step="0.01" className={inputClass} />
          </div>
        </div>

        {/* Deduction lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-400">Deduction lines</label>
            <button type="button" onClick={addLine} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">+ Add line</button>
          </div>
          {lines.length === 0 && <p className="text-xs text-gray-600">No deduction lines.</p>}
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                <input type="text" value={line.label} onChange={(e) => updateLine(i, { label: e.target.value })}
                  placeholder="Label" className={`${inputClass} text-xs`} />
                <select value={line.type} onChange={(e) => updateLine(i, { type: e.target.value as PayslipLineType })}
                  className={`${inputClass} text-xs`}>
                  {(Object.keys(LINE_TYPE_LABELS) as PayslipLineType[]).map((t) => (
                    <option key={t} value={t}>{LINE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <input type="number" value={line.amount} onChange={(e) => updateLine(i, { amount: parseFloat(e.target.value) || 0 })}
                  min="0" step="0.01" className={`${inputClass} text-xs w-24`} />
                <button type="button" onClick={() => deleteLine(i)}
                  className="text-red-500 hover:text-red-400 text-xs px-1 transition-colors">✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Reimbursements (info only) */}
        {(extraction.reimbursements?.length ?? 0) > 0 && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-400 transition-colors">
              Reimbursements (informational only — not included in income/deductions)
            </summary>
            <ul className="mt-2 space-y-1 pl-3">
              {extraction.reimbursements!.map((r: { label: string; amount: number }, i: number) => (
                <li key={i}>{r.label}: {r.amount.toLocaleString('en', { minimumFractionDigits: 2 })}</li>
              ))}
            </ul>
          </details>
        )}

        {/* AI notes */}
        {(extraction.notes?.length ?? 0) > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-xs text-gray-400 space-y-1">
            <p className="font-medium text-gray-300">AI notes</p>
            {extraction.notes!.map((note: string, i: number) => <p key={i}>{note}</p>)}
          </div>
        )}

        {/* Tax card settings (optional) */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setUpdateTaxCard((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:bg-gray-800/40 transition-colors"
          >
            <span className="font-medium">Also update tax card settings for future calculations</span>
            <span className="text-xs text-gray-500">{updateTaxCard ? '▲' : '▼'}</span>
          </button>

          {updateTaxCard && (
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-700 bg-gray-900/30">
              <p className="text-xs text-gray-500 mt-1">
                Pension %s are derived from this payslip. Trækprocent must be entered manually (it is on your skattekort, not on the payslip).
              </p>

              {/* Pension % — derived, editable */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Pension employee % <span className="text-gray-600 font-normal">(derived from payslip)</span>
                  </label>
                  <input type="number" value={tcPensionEmployeePct}
                    onChange={(e) => setTcPensionEmployeePct(e.target.value)}
                    min="0" max="100" step="0.01" placeholder="e.g. 3.00" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Pension employer % <span className="text-gray-600 font-normal">(derived from employer pension)</span>
                  </label>
                  <input type="number" value={tcPensionEmployerPct}
                    onChange={(e) => setTcPensionEmployerPct(e.target.value)}
                    min="0" max="100" step="0.01" placeholder="e.g. 10.00" className={inputClass} />
                </div>
              </div>

              {/* ATP */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    ATP / month <span className="text-gray-600 font-normal">(derived from payslip)</span>
                  </label>
                  <input type="number" value={tcAtpAmount}
                    onChange={(e) => setTcAtpAmount(e.target.value)}
                    min="0" step="0.01" placeholder="e.g. 99.00" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Effective from</label>
                  <input type="date" value={effectiveFrom} readOnly
                    className={`${inputClass} text-gray-400 cursor-default`} />
                </div>
              </div>

              {/* Trækprocent & personfradrag — must be entered manually */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Trækprocent % <span className="text-red-400">*</span>
                  </label>
                  <input type="number" value={traekprocent} onChange={(e) => setTraekprocent(e.target.value)}
                    min="0" max="100" step="0.01" placeholder="e.g. 38.00" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Månedsfradrag (DKK)</label>
                  <input type="number" value={personfradrag} onChange={(e) => setPersonfradrag(e.target.value)}
                    min="0" step="0.01" className={inputClass} />
                </div>
              </div>

              {updateTaxCard && !traekprocent && (
                <p className="text-xs text-amber-400">Enter trækprocent to enable tax card save.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={handleConfirm} disabled={isPending || (updateTaxCard && !traekprocent)}
            className={`flex-1 ${primaryBtn}`}>
            {isPending ? 'Saving…' : updateTaxCard && traekprocent ? 'Confirm, Save & Update Tax Card' : 'Confirm & Save'}
          </button>
          <button type="button" onClick={onClose}
            className={`flex-1 ${secondaryBtn}`}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
