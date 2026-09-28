import { useState } from 'react'
import type { PayslipExtraction } from '../../lib/parsePayslipCsv'
import { Modal } from '../../components/Modal'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import type { TaxCardDraft } from './types'

interface TaxCardFromPayslipModalProps {
  extraction: PayslipExtraction
  jobName: string
  onClose: () => void
  onConfirm: (taxCard: TaxCardDraft) => void
  isPending: boolean
}

export function TaxCardFromPayslipModal({ extraction, jobName, onClose, onConfirm, isPending }: TaxCardFromPayslipModalProps) {
  const round4 = (n: number) => Math.round(n * 10000) / 10000
  const gross = extraction.grossSalary
  const pensionEmployer = extraction.pensionEmployerMonthly ?? 0

  const derivedEmployeePct = gross > 0
    ? round4(extraction.lines.filter((l) => l.sankeyGroup === 'pension_employee').reduce((s, l) => s + l.amount, 0) / gross * 100)
    : 0
  const derivedEmployerPct = gross > 0 && pensionEmployer > 0
    ? round4(pensionEmployer / gross * 100)
    : 0
  const derivedAtp = extraction.lines.find((l) => l.sankeyGroup === 'atp')?.amount

  const [traekprocent, setTraekprocent] = useState('')
  const [personfradrag, setPersonfradrag] = useState('3875')
  const [pensionEmployeePct, setPensionEmployeePct] = useState(() => derivedEmployeePct > 0 ? String(derivedEmployeePct) : '')
  const [pensionEmployerPct, setPensionEmployerPct] = useState(() => derivedEmployerPct > 0 ? String(derivedEmployerPct) : '')
  const [atpAmount, setAtpAmount] = useState(() => derivedAtp != null ? String(derivedAtp) : '')
  const effectiveFrom = `${extraction.period.year}-${String(extraction.period.month).padStart(2, '0')}-01`

  function handleConfirm() {
    if (!traekprocent) return
    onConfirm({
      effectiveFrom,
      traekprocent: parseFloat(traekprocent),
      personfradragMonthly: parseFloat(personfradrag) || 3875,
      pensionEmployeePct: pensionEmployeePct ? parseFloat(pensionEmployeePct) : undefined,
      pensionEmployerPct: pensionEmployerPct ? parseFloat(pensionEmployerPct) : undefined,
      atpAmount: atpAmount ? parseFloat(atpAmount) : undefined,
    })
  }

  return (
    <Modal title={`Tax card from payslip — ${jobName}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          Pension %s are derived from the payslip amounts. Review and adjust if needed.
          Trækprocent and personfradrag are on your <strong className="text-gray-300">skattekort</strong> — enter them manually.
        </p>

        {/* Source info */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
          Source: <span className="text-gray-300">{extraction.employerName || 'Unknown employer'}</span>
          {' · '}{new Date(0, extraction.period.month - 1).toLocaleString('en', { month: 'long' })} {extraction.period.year}
          {' · '}Gross {extraction.grossSalary.toLocaleString('en', { minimumFractionDigits: 2 })} {extraction.currency}
        </div>

        {/* Pension % — derived, editable */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Pension employee % <span className="text-gray-600 font-normal">(derived)</span>
            </label>
            <input type="number" value={pensionEmployeePct} onChange={(e) => setPensionEmployeePct(e.target.value)}
              min="0" max="100" step="0.01" placeholder="e.g. 3.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Pension employer % <span className="text-gray-600 font-normal">(derived)</span>
            </label>
            <input type="number" value={pensionEmployerPct} onChange={(e) => setPensionEmployerPct(e.target.value)}
              min="0" max="100" step="0.01" placeholder="e.g. 10.00" className={inputClass} />
          </div>
        </div>

        {/* ATP */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              ATP / month <span className="text-gray-600 font-normal">(derived)</span>
            </label>
            <input type="number" value={atpAmount} onChange={(e) => setAtpAmount(e.target.value)}
              min="0" step="0.01" placeholder="e.g. 99.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Effective from</label>
            <input type="date" value={effectiveFrom} readOnly className={`${inputClass} text-gray-400 cursor-default`} />
          </div>
        </div>

        {/* Trækprocent & personfradrag — manual */}
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

        {!traekprocent && (
          <p className="text-xs text-amber-400">Trækprocent is required.</p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={handleConfirm} disabled={isPending || !traekprocent}
            className={`flex-1 ${primaryBtn}`}>
            {isPending ? 'Saving…' : 'Save Tax Card'}
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
