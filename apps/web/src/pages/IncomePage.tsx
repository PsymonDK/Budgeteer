import { useState, useMemo, useRef, type FormEvent, type ChangeEvent } from 'react'
import { parsePayslipCsv } from '../lib/parsePayslipCsv'
import type { PayslipExtraction, PayslipLine, PayslipLineType } from '../lib/parsePayslipCsv'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Modal } from '../components/Modal'
import { PageLoader } from '../components/LoadingSpinner'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../lib/styles'
import { useFmt } from '../hooks/useFmt'

// ── Types ─────────────────────────────────────────────────────────────────────

type BudgetMode = 'ONE_OFF' | 'SPREAD_ANNUALLY'

interface SalaryRecord {
  id: string
  jobId: string
  grossAmount: string
  netAmount: string
  effectiveFrom: string
  currencyCode: string | null
  rateUsed: string | null
  amBidragAmount: string | null
  aSkattAmount: string | null
  pensionEmployeeAmount: string | null
  pensionEmployerAmount: string | null
  atpAmount: string | null
  bruttoDeductionAmount: string | null
  deductionsSource: string | null
  createdAt: string
}

interface MonthlyOverride {
  id: string
  jobId: string
  year: number
  month: number
  grossAmount: string
  netAmount: string
  note: string | null
  amBidragAmount: string | null
  aSkattAmount: string | null
  pensionEmployeeAmount: string | null
  pensionEmployerAmount: string | null
  atpAmount: string | null
  bruttoDeductionAmount: string | null
  deductionsSource: string | null
  createdAt: string
}

interface TaxCardSettings {
  id: string
  jobId: string
  effectiveFrom: string
  traekprocent: string
  personfradragMonthly: string
  municipality: string | null
  pensionEmployeePct: string | null
  pensionEmployerPct: string | null
  atpAmount: string | null
  bruttoItems: { label: string; monthlyAmount: number }[] | null
  createdAt: string
}

interface Bonus {
  id: string
  jobId: string
  label: string
  grossAmount: string
  netAmount: string
  paymentDate: string
  includeInBudget: boolean
  budgetMode: BudgetMode | null
  currencyCode: string | null
  rateUsed: string | null
  createdAt: string
}

interface Currency {
  code: string
  rate: number
  baseCurrency: string
}

interface JobAllocation {
  budgetYearId: string
  allocationPct: string
  budgetYear: {
    id: string
    year: number
    status: string
    household: { id: string; name: string }
  }
}

interface Job {
  id: string
  name: string
  employer: string | null
  country: string
  startDate: string
  endDate: string | null
  isActive: boolean
  latestSalary: SalaryRecord | null
  upcomingBonusCount: number
  allocations: JobAllocation[]
}

interface Household {
  id: string
  name: string
}

interface HistoryBucket {
  period: string
  gross: number
  net: number
  total: number
  perJob: { jobId: string; jobName: string; gross: number; net: number }[]
  bonuses: { jobId: string; label: string; gross: number; net: number }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']


function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

function toDateInput(iso: string) {
  return iso.slice(0, 10)
}

type Tab = 'jobs' | 'overrides' | 'bonuses'
type Granularity = 'monthly' | 'quarterly' | 'yearly'

// ── Sub-forms ─────────────────────────────────────────────────────────────────

interface JobForm { name: string; employer: string; country: string; startDate: string; endDate: string }
interface SalaryForm { grossAmount: string; netAmount: string; effectiveFrom: string; currencyCode: string }
interface OverrideForm { year: string; month: string; grossAmount: string; netAmount: string; note: string }
interface BonusForm { label: string; grossAmount: string; netAmount: string; paymentDate: string; includeInBudget: boolean; budgetMode: BudgetMode | ''; currencyCode: string }

interface TaxCardForm {
  effectiveFrom: string
  traekprocent: string
  personfradragMonthly: string
  municipality: string
  pensionEmployeePct: string
  pensionEmployerPct: string
  atpAmount: string
  bruttoItems: { label: string; monthlyAmount: string }[]
}

interface DeductionOverrides {
  amBidragAmount: string
  aSkattAmount: string
  pensionEmployeeAmount: string
  atpAmount: string
}

const emptyJob: JobForm = { name: '', employer: '', country: 'DK', startDate: new Date().toISOString().slice(0, 10), endDate: '' }
const emptySalary = (baseCurrency: string): SalaryForm => ({ grossAmount: '', netAmount: '', effectiveFrom: new Date().toISOString().slice(0, 10), currencyCode: baseCurrency })
const emptyOverride: OverrideForm = { year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1), grossAmount: '', netAmount: '', note: '' }
const emptyBonus = (baseCurrency: string): BonusForm => ({ label: '', grossAmount: '', netAmount: '', paymentDate: new Date().toISOString().slice(0, 10), includeInBudget: true, budgetMode: 'ONE_OFF', currencyCode: baseCurrency })
const emptyTaxCard = (): TaxCardForm => ({ effectiveFrom: new Date().toISOString().slice(0, 10), traekprocent: '', personfradragMonthly: '3875', municipality: '', pensionEmployeePct: '', pensionEmployerPct: '', atpAmount: '', bruttoItems: [] })
const emptyDeductionOverrides = (): DeductionOverrides => ({ amBidragAmount: '', aSkattAmount: '', pensionEmployeeAmount: '', atpAmount: '' })

// ── Inline DK tax calculation (mirrors packages/shared/src/index.ts) ──────────

const TOP_SKAT_THRESHOLD = 49_075
const TOP_SKAT_RATE = 0.15
const AM_BIDRAG_RATE = 0.08
const DEFAULT_ATP = 99

function r2(n: number) { return Math.round(n * 100) / 100 }

interface LiveDeductions {
  amBidrag: number; aSkat: number; topSkat: number; atp: number
  pensionEmployee: number; pensionEmployer: number; bruttoTotal: number; bruttoItems: { label: string; monthlyAmount: number }[]; net: number
}

/**
 * Correct Danish payroll calculation order:
 *   1. Pre-AM: brutto items + pension employee + ATP → all reduce AM base
 *   2. AM-bidrag = 8% of AM-indkomst (truncated to whole DKK)
 *   3. A-skat = bottom tax + top-skat (both truncated to whole DKK)
 *   4. Net = gross − preAmTotal − amBidrag − aSkat
 */
function calcDanishDeductions(
  gross: number,
  settings: { traekprocent: number; personfradragMonthly: number; pensionEmployeePct?: number | null; pensionEmployerPct?: number | null; atpAmount?: number | null; bruttoItems?: { label: string; monthlyAmount: number }[] | null }
): LiveDeductions {
  const bruttoItems = settings.bruttoItems ?? []
  const bruttoTotal = r2(bruttoItems.reduce((s, i) => s + i.monthlyAmount, 0))
  const pensionEmployee = settings.pensionEmployeePct ? r2(gross * settings.pensionEmployeePct / 100) : 0
  const atp = Math.floor(settings.atpAmount ?? DEFAULT_ATP)
  const preAmTotal = r2(bruttoTotal + pensionEmployee + atp)
  const amBase = gross - preAmTotal
  const amBidrag = Math.floor(amBase * AM_BIDRAG_RATE)
  const aIndkomst = amBase - amBidrag
  const taxableBase = Math.max(0, aIndkomst - settings.personfradragMonthly)
  const bottomTax = Math.floor(taxableBase * settings.traekprocent / 100)
  const topSkat = Math.floor(Math.max(0, aIndkomst - TOP_SKAT_THRESHOLD) * TOP_SKAT_RATE)
  const aSkat = bottomTax + topSkat
  const pensionEmployer = settings.pensionEmployerPct ? r2(gross * settings.pensionEmployerPct / 100) : 0
  const net = r2(gross - preAmTotal - amBidrag - aSkat)
  return { amBidrag, aSkat, topSkat, atp, pensionEmployee, pensionEmployer, bruttoTotal, bruttoItems, net }
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function DeductionPanel({ gross, liveCalc, overrides, onOverrideChange, hasTaxCard, baseCurrency }: DeductionPanelProps) {
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
          <span className={`text-xs px-1.5 py-0.5 rounded ${isManual ? 'bg-amber-900/50 text-amber-400 border border-amber-700' : 'bg-gray-700 text-gray-400'}`}>
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
        <span className="tabular-nums text-amber-400">{fmt2(displayNet, baseCurrency)}</span>
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

interface TaxCardSectionProps {
  jobId: string
  cards: TaxCardSettings[]
  isExpanded: boolean
  onToggle: () => void
  showForm: boolean
  editingCardId: string | null
  onShowForm: () => void
  onEditCard: (card: TaxCardSettings) => void
  onHideForm: () => void
  onImportFromPayslip: () => void
  form: TaxCardForm
  onFormChange: (f: TaxCardForm) => void
  onSubmit: (e: FormEvent) => void
  isPending: boolean
  error: string
  fmt: (v: number | string) => string
}

function TaxCardSection({ jobId: _jobId, cards, isExpanded, onToggle, showForm, editingCardId, onShowForm, onEditCard, onHideForm, onImportFromPayslip, form, onFormChange, onSubmit, isPending, error, fmt }: TaxCardSectionProps) {
  const activeCard = cards[0] ?? null
  return (
    <div className="border-t border-gray-800 pt-4 mt-2">
      <button type="button" onClick={onToggle}
        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition-colors mb-2">
        <span>Tax card settings</span>
        {activeCard && <span className="text-green-400">● Active</span>}
        <span>{isExpanded ? '▲' : '▼'}</span>
      </button>
      {isExpanded && (
        <div className="space-y-3">
          {cards.length > 0 && (
            <div className="space-y-2">
              {cards.map((card, i) => (
                <div key={card.id} className="bg-gray-800 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-300 font-medium">
                      {new Date(card.effectiveFrom).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                    {i === 0 && <span className="text-xs bg-green-900/50 text-green-400 border border-green-700 px-1.5 py-0.5 rounded">Active</span>}
                    <button type="button" onClick={() => onEditCard(card)}
                      className="ml-auto text-xs text-gray-500 hover:text-amber-400 transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-amber-700">
                      Edit
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-400">
                    <span>Trækprocent: <span className="text-white">{parseFloat(card.traekprocent).toFixed(2)}%</span></span>
                    <span>Personfradrag: <span className="text-white">{fmt(card.personfradragMonthly)}</span></span>
                    {card.pensionEmployeePct && <span>Pension emp.: <span className="text-white">{parseFloat(card.pensionEmployeePct).toFixed(2)}%</span></span>}
                    {card.pensionEmployerPct && <span>Pension er.: <span className="text-white">{parseFloat(card.pensionEmployerPct).toFixed(2)}%</span></span>}
                    {card.municipality && <span>Municipality: <span className="text-white">{card.municipality}</span></span>}
                  </div>
                  {card.bruttoItems && card.bruttoItems.length > 0 && (
                    <div className="mt-1.5 text-xs text-gray-500">
                      Brutto: {card.bruttoItems.map((b) => `${b.label} (${fmt(b.monthlyAmount)})`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!showForm ? (
            <div className="flex gap-2">
              <button type="button" onClick={onShowForm}
                className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                + Add tax card record
              </button>
              <button type="button" onClick={onImportFromPayslip}
                className="text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors">
                Import from payslip
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="bg-gray-800 rounded-lg p-4 space-y-3">
              <p className="text-xs font-medium text-gray-300 mb-2">{editingCardId ? 'Edit tax card settings' : 'New tax card settings'}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Effective from</label>
                  <input type="date" value={form.effectiveFrom} onChange={(e) => onFormChange({ ...form, effectiveFrom: e.target.value })}
                    required className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Trækprocent (%)</label>
                  <input type="number" value={form.traekprocent} onChange={(e) => onFormChange({ ...form, traekprocent: e.target.value })}
                    required min="0" max="100" step="0.01" placeholder="38.00"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Personfradrag / month</label>
                  <input type="number" value={form.personfradragMonthly} onChange={(e) => onFormChange({ ...form, personfradragMonthly: e.target.value })}
                    required min="0" step="0.01" placeholder="3875"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Pension employee %</label>
                  <input type="number" value={form.pensionEmployeePct} onChange={(e) => onFormChange({ ...form, pensionEmployeePct: e.target.value })}
                    min="0" max="100" step="0.01" placeholder="4.00"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Pension employer %</label>
                  <input type="number" value={form.pensionEmployerPct} onChange={(e) => onFormChange({ ...form, pensionEmployerPct: e.target.value })}
                    min="0" max="100" step="0.01" placeholder="8.00"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ATP override (DKK)</label>
                  <input type="number" value={form.atpAmount} onChange={(e) => onFormChange({ ...form, atpAmount: e.target.value })}
                    min="0" step="0.01" placeholder="99 (default)"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Municipality <span className="text-gray-600">(optional)</span></label>
                <input type="text" value={form.municipality} onChange={(e) => onFormChange({ ...form, municipality: e.target.value })}
                  placeholder="e.g. Copenhagen"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              {/* Bruttolønsordning */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Bruttolønsordning items</label>
                {form.bruttoItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <input type="text" value={item.label} onChange={(e) => { const items = [...form.bruttoItems]; items[idx] = { ...items[idx], label: e.target.value }; onFormChange({ ...form, bruttoItems: items }) }}
                      placeholder="Label (e.g. Phone)" className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    <input type="number" value={item.monthlyAmount} onChange={(e) => { const items = [...form.bruttoItems]; items[idx] = { ...items[idx], monthlyAmount: e.target.value }; onFormChange({ ...form, bruttoItems: items }) }}
                      placeholder="Amount" min="0" step="0.01" className="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    <button type="button" onClick={() => onFormChange({ ...form, bruttoItems: form.bruttoItems.filter((_, i) => i !== idx) })}
                      className="text-red-500 hover:text-red-400 text-sm px-1">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => onFormChange({ ...form, bruttoItems: [...form.bruttoItems, { label: '', monthlyAmount: '' }] })}
                  className="text-xs text-gray-400 hover:text-white border border-gray-600 px-2 py-1 rounded transition-colors">+ Add item</button>
              </div>
              {error && <div className="bg-red-950 border border-red-800 text-red-300 px-3 py-2 rounded text-xs">{error}</div>}
              <div className="flex gap-2">
                <button type="submit" disabled={isPending}
                  className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5 rounded transition-colors">
                  {isPending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={onHideForm} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ── Payslip CSV template ──────────────────────────────────────────────────────

const PAYSLIP_CSV_TEMPLATE = `# Payslip Import Template for Budgeteer
# Fill in the values below and upload this file via the Import Payslip dialog.
# Lines starting with # are comments and will be ignored.
#
# METADATA ROWS (row_type = meta):
#   meta,year,,YYYY               (required)
#   meta,month,,M                 (required, 1-12)
#   meta,employer,,Company Name   (optional)
#   meta,currency,,DKK            (optional, default: DKK)
#   meta,gross,,AMOUNT            (required, total monthly salary excl. reimbursements)
#   meta,net,,AMOUNT              (required, amount transferred to bank account)
#   meta,pension_employer,,AMOUNT (optional, employer pension DKK/month — used to derive pension employer %)
#
# DEDUCTION LINE ROWS (row_type = line):
#   Valid types:
#   benefit_in_kind  Taxable benefit value added to gross (Fri telefon, phone/device value)
#   pre_am           Deductions that reduce AM base: pension employee (DKK amount), ATP, health insurance brutto
#   am_bidrag        AM-bidrag (8% of AM-indkomst)
#   a_skat           A-skat (income tax)
#   post_tax         After-tax deductions: canteen, union fees, health insurance netto
#
row_type,key_or_type,label,value_or_amount
meta,year,,2025
meta,month,,1
meta,employer,,Your Employer A/S
meta,currency,,DKK
meta,gross,,50000.00
meta,net,,30000.00
meta,pension_employer,,0.00
line,pre_am,Pension (employee),1500.00
line,pre_am,ATP,99.00
line,am_bidrag,"AM-bidrag (8%)",3880.00
line,a_skat,A-skat,14521.00
`

const LINE_TYPE_LABELS: Record<PayslipLineType, string> = {
  benefit_in_kind: 'Benefit in kind (brutto)',
  pre_am: 'Pre-tax deduction (AM base)',
  am_bidrag: 'AM-bidrag (8%)',
  a_skat: 'A-skat',
  post_tax: 'Post-tax deduction',
}

const LINE_TYPE_SANKEY: Record<PayslipLineType, string> = {
  benefit_in_kind: 'brutto_benefits',
  pre_am: 'other_deductions',
  am_bidrag: 'am_bidrag',
  a_skat: 'a_skat',
  post_tax: 'other_deductions',
}

// ── PayslipImportModal ────────────────────────────────────────────────────────

interface PayslipImportModalProps {
  jobId: string
  jobName: string
  onClose: () => void
  onExtracted: (data: PayslipExtraction) => void
}

function PayslipImportModal({ jobId, jobName, onClose, onExtracted }: PayslipImportModalProps) {
  const [tab, setTab] = useState<'csv' | 'manual' | 'ai'>('csv')
  const [csvError, setCsvError] = useState('')
  const csvInputRef = useRef<HTMLInputElement>(null)

  // Manual entry state
  const [manYear, setManYear] = useState(String(new Date().getFullYear()))
  const [manMonth, setManMonth] = useState(String(new Date().getMonth() + 1))
  const [manEmployer, setManEmployer] = useState('')
  const [manGross, setManGross] = useState('')
  const [manNet, setManNet] = useState('')
  const [manPensionEmployer, setManPensionEmployer] = useState('')
  const [manLines, setManLines] = useState<PayslipLine[]>([])
  const [manError, setManError] = useState('')

  // AI state
  const [aiConsent, setAiConsent] = useState(false)
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  function downloadTemplate() {
    const blob = new Blob([PAYSLIP_CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'payslip-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const extraction = parsePayslipCsv(text)
        onExtracted(extraction)
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV')
      }
    }
    reader.readAsText(file)
  }

  function handleManualReview() {
    setManError('')
    const year = parseInt(manYear)
    const month = parseInt(manMonth)
    const gross = parseFloat(manGross)
    const net = parseFloat(manNet)
    if (isNaN(year) || year < 2000) { setManError('Invalid year'); return }
    if (isNaN(month) || month < 1 || month > 12) { setManError('Invalid month'); return }
    if (isNaN(gross) || gross <= 0) { setManError('Invalid gross amount'); return }
    if (isNaN(net) || net <= 0) { setManError('Invalid net amount'); return }
    const pensionEmployer = parseFloat(manPensionEmployer)
    onExtracted({
      period: { year, month },
      employerName: manEmployer,
      grossSalary: gross,
      netPay: net,
      currency: 'DKK',
      lines: manLines,
      pensionEmployerMonthly: isNaN(pensionEmployer) ? undefined : pensionEmployer,
      confidence: 'high',
    })
  }

  function addManualLine() {
    setManLines((prev) => [...prev, { label: '', amount: 0, type: 'post_tax', sankeyGroup: 'other_deductions', isCalculated: false }])
  }

  function updateManualLine(i: number, changes: Partial<PayslipLine>) {
    setManLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const updated = { ...l, ...changes }
      if (changes.type) updated.sankeyGroup = LINE_TYPE_SANKEY[changes.type] as PayslipLine['sankeyGroup']
      return updated
    }))
  }

  async function handleAiParse() {
    setAiLoading(true); setAiError('')
    try {
      let body: Record<string, string>
      if (aiFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            resolve(dataUrl.split(',')[1])
          }
          reader.onerror = reject
          reader.readAsDataURL(aiFile)
        })
        body = { fileBase64: base64, mimeType: aiFile.type }
      } else if (aiText.trim()) {
        body = { rawText: aiText.trim() }
      } else {
        setAiError('Please upload a file or paste payslip text'); setAiLoading(false); return
      }
      const response = await import('../api/client').then((m) => m.api.post<PayslipExtraction>(`/jobs/${jobId}/payslips/parse`, body))
      onExtracted(response.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Parsing failed'
      if (msg.includes('AI_NOT_CONFIGURED') || msg.includes('not enabled')) {
        setAiError('AI parsing is not enabled on this server. Set ANTHROPIC_API_KEY in your server environment.')
      } else {
        setAiError(msg)
      }
    } finally {
      setAiLoading(false)
    }
  }

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-white'}`

  return (
    <Modal title={`Import payslip — ${jobName}`} onClose={onClose} size="lg">
      <div className="flex border-b border-gray-800 mb-5 -mt-1">
        <button className={tabCls('csv')} onClick={() => setTab('csv')}>CSV Template</button>
        <button className={tabCls('manual')} onClick={() => setTab('manual')}>Enter Manually</button>
        <button className={tabCls('ai')} onClick={() => setTab('ai')}>AI Parse</button>
      </div>

      {/* ── CSV tab ── */}
      {tab === 'csv' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Download the template, fill in your payslip numbers, then upload the completed file.
            No data leaves your system — the file is parsed entirely in your browser.
          </p>
          <button onClick={downloadTemplate}
            className="text-sm text-amber-400 hover:text-amber-300 border border-amber-700 px-4 py-2 rounded-lg transition-colors">
            Download template (CSV)
          </button>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Upload completed CSV</label>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile}
              className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600 cursor-pointer" />
          </div>
          {csvError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{csvError}</div>}
        </div>
      )}

      {/* ── Manual tab ── */}
      {tab === 'manual' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
              <input type="number" value={manYear} onChange={(e) => setManYear(e.target.value)} min="2000" max="2100" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
              <select value={manMonth} onChange={(e) => setManMonth(e.target.value)} className={inputClass}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Employer <span className="text-gray-600">(optional)</span></label>
            <input type="text" value={manEmployer} onChange={(e) => setManEmployer(e.target.value)} placeholder="Company A/S" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
              <input type="number" value={manGross} onChange={(e) => setManGross(e.target.value)} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Net pay (to bank)</label>
              <input type="number" value={manNet} onChange={(e) => setManNet(e.target.value)} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Employer pension <span className="text-gray-600">(optional)</span></label>
            <input type="number" value={manPensionEmployer} onChange={(e) => setManPensionEmployer(e.target.value)} min="0" step="0.01" placeholder="0.00" className={inputClass} />
          </div>

          {/* Deduction lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-400">Deduction lines</label>
              <button type="button" onClick={addManualLine} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">+ Add line</button>
            </div>
            {manLines.length === 0 && <p className="text-xs text-gray-600">No lines added. Click &quot;+ Add line&quot; to start.</p>}
            <div className="space-y-2">
              {manLines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input type="text" value={line.label} onChange={(e) => updateManualLine(i, { label: e.target.value })}
                    placeholder="Label" className={`${inputClass} text-xs`} />
                  <select value={line.type} onChange={(e) => updateManualLine(i, { type: e.target.value as PayslipLineType })}
                    className={`${inputClass} text-xs`}>
                    {(Object.keys(LINE_TYPE_LABELS) as PayslipLineType[]).map((t) => (
                      <option key={t} value={t}>{LINE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <input type="number" value={line.amount} onChange={(e) => updateManualLine(i, { amount: parseFloat(e.target.value) || 0 })}
                    min="0" step="0.01" placeholder="0.00" className={`${inputClass} text-xs w-24`} />
                  <button type="button" onClick={() => setManLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-red-500 hover:text-red-400 text-xs px-1 transition-colors">✕</button>
                </div>
              ))}
            </div>
          </div>

          {manError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{manError}</div>}
          <button type="button" onClick={handleManualReview}
            className="w-full bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
            Review →
          </button>
        </div>
      )}

      {/* ── AI tab ── */}
      {tab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-amber-950/50 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300">
            <p className="font-medium mb-1">Privacy warning</p>
            <p>This will send your payslip data to Anthropic's API. Your payslip contains personal financial information including salary, tax, and pension details. Only proceed if you consent to this data leaving your system.</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)}
              className="mt-0.5 rounded border-gray-600 bg-gray-800 text-amber-400 focus:ring-amber-400" />
            <span className="text-sm text-gray-300">I understand and consent to sending my payslip data to Anthropic's API</span>
          </label>

          {aiConsent && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Upload payslip (PDF, PNG, or JPEG)</label>
                <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setAiFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600 cursor-pointer" />
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <div className="flex-1 h-px bg-gray-800" />
                <span>or paste text</span>
                <div className="flex-1 h-px bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Paste payslip text</label>
                <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={6}
                  placeholder="Copy and paste the text content of your payslip here..."
                  className={`${inputClass} resize-y text-xs font-mono`} />
              </div>
              {aiError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{aiError}</div>}
              <button type="button" onClick={handleAiParse} disabled={aiLoading || (!aiFile && !aiText.trim())}
                className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
                {aiLoading ? 'Parsing…' : 'Parse with AI →'}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── PayslipReviewModal ────────────────────────────────────────────────────────

export interface TaxCardDraft {
  effectiveFrom: string
  traekprocent: number
  personfradragMonthly: number
  pensionEmployeePct?: number
  pensionEmployerPct?: number
  atpAmount?: number
}

interface PayslipReviewModalProps {
  extraction: PayslipExtraction
  jobName: string
  onClose: () => void
  onConfirm: (data: PayslipExtraction, taxCard?: TaxCardDraft) => void
  isPending: boolean
}

function PayslipReviewModal({ extraction, jobName, onClose, onConfirm, isPending }: PayslipReviewModalProps) {
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
            className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
            {isPending ? 'Saving…' : updateTaxCard && traekprocent ? 'Confirm, Save & Update Tax Card' : 'Confirm & Save'}
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── TaxCardFromPayslipModal ───────────────────────────────────────────────────

interface TaxCardFromPayslipModalProps {
  extraction: PayslipExtraction
  jobName: string
  onClose: () => void
  onConfirm: (taxCard: TaxCardDraft) => void
  isPending: boolean
}

function TaxCardFromPayslipModal({ extraction, jobName, onClose, onConfirm, isPending }: TaxCardFromPayslipModalProps) {
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
            className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
            {isPending ? 'Saving…' : 'Save Tax Card'}
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IncomePage() {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const fmt = useFmt()
  const [params] = useSearchParams()
  const proxyUserId = params.get('proxyUserId')
  const isProxy = !!proxyUserId && (me?.role === 'SYSTEM_ADMIN' || me?.role === 'BOOKKEEPER')
  const targetUserId = isProxy ? proxyUserId : me?.id

  const [activeTab, setActiveTab] = useState<Tab>('jobs')

  // Job modal
  const [showAddJob, setShowAddJob] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [jobForm, setJobForm] = useState<JobForm>(emptyJob)
  const [jobFormError, setJobFormError] = useState('')

  // Salary modal
  const [salaryJobId, setSalaryJobId] = useState<string | null>(null)
  const [salaryForm, setSalaryForm] = useState<SalaryForm>(emptySalary(''))
  const [salaryError, setSalaryError] = useState('')
  const [editingSalary, setEditingSalary] = useState<SalaryRecord | null>(null)

  // Override modal
  const [overrideJobId, setOverrideJobId] = useState<string | null>(null)
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(emptyOverride)
  const [overrideError, setOverrideError] = useState('')

  // Bonus modal
  const [bonusJobId, setBonusJobId] = useState<string | null>(null)
  const [editingBonus, setEditingBonus] = useState<Bonus | null>(null)
  const [bonusForm, setBonusForm] = useState<BonusForm>(emptyBonus(''))
  const [bonusError, setBonusError] = useState('')

  // Allocations
  const [pendingAllocations, setPendingAllocations] = useState<Record<string, string>>({})
  const [allocError, setAllocError] = useState('')
  const [allocationsDirty, setAllocationsDirty] = useState(false)

  // Tax card settings
  const [taxCardJobId, setTaxCardJobId] = useState<string | null>(null)
  const [showTaxCardForm, setShowTaxCardForm] = useState(false)
  const [taxCardForm, setTaxCardForm] = useState<TaxCardForm>(emptyTaxCard())
  const [taxCardError, setTaxCardError] = useState('')
  const [editingTaxCardId, setEditingTaxCardId] = useState<string | null>(null)

  // Deduction overrides (salary + override forms)
  const [salaryDeductionOverrides, setSalaryDeductionOverrides] = useState<DeductionOverrides>(emptyDeductionOverrides())
  const [overrideDeductionOpen, setOverrideDeductionOpen] = useState(false)
  const [overrideDeductionOverrides, setOverrideDeductionOverrides] = useState<DeductionOverrides>(emptyDeductionOverrides())

  // Confirmation dialogs
  const [confirmCloseJob, setConfirmCloseJob] = useState<Job | null>(null)
  const [confirmDeleteBonus, setConfirmDeleteBonus] = useState<{ jobId: string; bonusId: string } | null>(null)
  const [confirmDeleteOverride, setConfirmDeleteOverride] = useState<{ jobId: string; overrideId: string } | null>(null)

  // Payslip import
  const [payslipImportJobId, setPayslipImportJobId] = useState<string | null>(null)
  const [payslipReviewData, setPayslipReviewData] = useState<PayslipExtraction | null>(null)
  const [payslipReviewJobId, setPayslipReviewJobId] = useState<string | null>(null)

  // Tax card from payslip (separate flow — no override, taxcard only)
  const [taxCardPayslipJobId, setTaxCardPayslipJobId] = useState<string | null>(null)
  const [taxCardPayslipData, setTaxCardPayslipData] = useState<PayslipExtraction | null>(null)

  // History chart
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 7)
  })
  const [histTo, setHistTo] = useState(() => new Date().toISOString().slice(0, 7))
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [showGross, setShowGross] = useState(true)

  // ── Queries ───────────────────────────────────────────────────────────────

  // Fetch users list to get proxy user name (only when acting as proxy)
  const { data: allUsers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/users')).data,
    enabled: isProxy,
  })
  const proxyUserName = isProxy ? allUsers.find((u) => u.id === proxyUserId)?.name : undefined

  const { data: config } = useQuery<{ baseCurrency: string }>({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ baseCurrency: string }>('/config')).data,
  })
  const baseCurrency = config?.baseCurrency ?? 'DKK'

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ['jobs', targetUserId],
    queryFn: async () => (await api.get<Job[]>(`/users/${targetUserId}/jobs`)).data,
    enabled: !!targetUserId,
  })

  const { data: households = [] } = useQuery<Household[]>({
    queryKey: ['households'],
    queryFn: async () => (await api.get<Household[]>('/households')).data,
  })

  const { data: salaryRecords = [] } = useQuery<SalaryRecord[]>({
    queryKey: ['salary', salaryJobId],
    queryFn: async () => (await api.get<SalaryRecord[]>(`/jobs/${salaryJobId}/salary`)).data,
    enabled: !!salaryJobId,
  })

  // Load overrides for all jobs on the overrides tab
  const { data: allJobsOverrides = {} } = useQuery<Record<string, MonthlyOverride[]>>({
    queryKey: ['all-overrides', jobs.map((j) => j.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<MonthlyOverride[]>(`/jobs/${j.id}/overrides`)
          return [j.id, res.data] as [string, MonthlyOverride[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'overrides' && jobs.length > 0,
  })

  // Load bonuses for all jobs on the bonuses tab
  const { data: allJobsBonuses = {} } = useQuery<Record<string, Bonus[]>>({
    queryKey: ['all-bonuses', jobs.map((j) => j.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<Bonus[]>(`/jobs/${j.id}/bonuses`)
          return [j.id, res.data] as [string, Bonus[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'bonuses' && jobs.length > 0,
  })

  const { data: taxCards = {} } = useQuery<Record<string, TaxCardSettings[]>>({
    queryKey: ['taxcards', jobs.map((j) => j.id).join(',')],
    queryFn: async () => {
      const dkJobs = jobs.filter((j) => j.country === 'DK')
      const results = await Promise.all(
        dkJobs.map(async (j) => {
          const res = await api.get<TaxCardSettings[]>(`/jobs/${j.id}/taxcard`)
          return [j.id, res.data] as [string, TaxCardSettings[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: jobs.length > 0,
  })

  const { data: historyData } = useQuery<{ buckets: HistoryBucket[] }>({
    queryKey: ['income-history', targetUserId, histFrom, histTo, granularity],
    queryFn: async () =>
      (await api.get(`/users/${targetUserId}/income/history`, { params: { from: histFrom, to: histTo, granularity } })).data,
    enabled: !!targetUserId,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.post(`/users/${targetUserId}/jobs`, {
        name: data.name, employer: data.employer || undefined, country: data.country,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setShowAddJob(false); setJobForm(emptyJob); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.put(`/users/${targetUserId}/jobs/${editingJob!.id}`, {
        name: data.name, employer: data.employer || undefined, country: data.country,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setEditingJob(null); setJobForm(emptyJob); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const closeJobMutation = useMutation({
    mutationFn: (jobId: string) => api.delete(`/users/${targetUserId}/jobs/${jobId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job closed') },
  })

  const addSalaryMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: SalaryForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const hasManualOverride = Object.values(deductionOverrides).some((v) => v !== '')
      const deductionPayload = (liveCalc && hasManualOverride) ? {
        payslipLines: buildPayslipLines(liveCalc, deductionOverrides),
      } : {}
      const net = liveCalc
        ? (hasManualOverride ? computeManualNet(parseFloat(form.grossAmount), liveCalc, deductionOverrides) : liveCalc.net)
        : parseFloat(form.netAmount)
      return api.post(`/jobs/${salaryJobId}/salary`, {
        grossAmount: parseFloat(form.grossAmount), netAmount: net, effectiveFrom: form.effectiveFrom,
        ...(form.currencyCode && form.currencyCode !== baseCurrency ? { currencyCode: form.currencyCode } : {}),
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary', salaryJobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('')
      toast.success('Salary record added')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setSalaryError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateSalaryMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: SalaryForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const hasManualOverride = Object.values(deductionOverrides).some((v) => v !== '')
      const deductionPayload = (liveCalc && hasManualOverride) ? {
        payslipLines: buildPayslipLines(liveCalc, deductionOverrides),
      } : {}
      const net = liveCalc
        ? (hasManualOverride ? computeManualNet(parseFloat(form.grossAmount), liveCalc, deductionOverrides) : liveCalc.net)
        : parseFloat(form.netAmount)
      return api.put(`/jobs/${salaryJobId}/salary/${editingSalary!.id}`, {
        grossAmount: parseFloat(form.grossAmount), netAmount: net, effectiveFrom: form.effectiveFrom,
        ...(form.currencyCode && form.currencyCode !== baseCurrency ? { currencyCode: form.currencyCode } : {}),
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary', salaryJobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('')
      toast.success('Salary record updated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setSalaryError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteSalaryMutation = useMutation({
    mutationFn: (salaryId: string) => api.delete(`/jobs/${salaryJobId}/salary/${salaryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary', salaryJobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Salary record deleted')
    },
  })

  const upsertOverrideMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: OverrideForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const hasManualOverride = Object.values(deductionOverrides).some((v) => v !== '')
      const deductionPayload = (liveCalc && hasManualOverride) ? {
        payslipLines: buildPayslipLines(liveCalc, deductionOverrides),
      } : {}
      const net = liveCalc
        ? (hasManualOverride ? computeManualNet(parseFloat(form.grossAmount), liveCalc, deductionOverrides) : liveCalc.net)
        : parseFloat(form.netAmount)
      return api.post(`/jobs/${overrideJobId}/overrides`, {
        year: parseInt(form.year), month: parseInt(form.month),
        grossAmount: parseFloat(form.grossAmount), netAmount: net,
        note: form.note || undefined,
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overrides', overrideJobId] })
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
      setOverrideForm(emptyOverride); setOverrideDeductionOverrides(emptyDeductionOverrides()); setOverrideDeductionOpen(false); setOverrideError('')
      toast.success('Monthly override saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setOverrideError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  function buildTaxCardPayload(data: TaxCardForm) {
    return {
      effectiveFrom: data.effectiveFrom,
      traekprocent: parseFloat(data.traekprocent),
      personfradragMonthly: parseFloat(data.personfradragMonthly),
      municipality: data.municipality || undefined,
      pensionEmployeePct: data.pensionEmployeePct ? parseFloat(data.pensionEmployeePct) : undefined,
      pensionEmployerPct: data.pensionEmployerPct ? parseFloat(data.pensionEmployerPct) : undefined,
      atpAmount: data.atpAmount ? parseFloat(data.atpAmount) : undefined,
      bruttoItems: data.bruttoItems.filter((i) => i.label && i.monthlyAmount).map((i) => ({ label: i.label, monthlyAmount: parseFloat(i.monthlyAmount) })),
    }
  }

  function invalidateAfterTaxCardChange() {
    queryClient.invalidateQueries({ queryKey: ['taxcards'] })
    queryClient.invalidateQueries({ queryKey: ['salary', taxCardJobId] })
    queryClient.invalidateQueries({ queryKey: ['overrides', taxCardJobId] })
    queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }

  const createTaxCardMutation = useMutation({
    mutationFn: (data: TaxCardForm) => api.post(`/jobs/${taxCardJobId}/taxcard`, buildTaxCardPayload(data)),
    onSuccess: () => {
      invalidateAfterTaxCardChange()
      setShowTaxCardForm(false); setTaxCardForm(emptyTaxCard()); setTaxCardError('')
      toast.success('Tax card saved — salary records recalculated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setTaxCardError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateTaxCardMutation = useMutation({
    mutationFn: (data: TaxCardForm) => api.put(`/jobs/${taxCardJobId}/taxcard/${editingTaxCardId}`, buildTaxCardPayload(data)),
    onSuccess: () => {
      invalidateAfterTaxCardChange()
      setEditingTaxCardId(null); setShowTaxCardForm(false); setTaxCardForm(emptyTaxCard()); setTaxCardError('')
      toast.success('Tax card updated — salary records recalculated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setTaxCardError((err.response?.data as { error?: string })?.error ?? 'Failed to update') },
  })

  const taxCardFromPayslipMutation = useMutation({
    mutationFn: ({ jobId, taxCard }: { jobId: string; taxCard: TaxCardDraft }) =>
      api.post(`/jobs/${jobId}/taxcard`, taxCard),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxcards'] })
      queryClient.invalidateQueries({ queryKey: ['salary', taxCardPayslipJobId] })
      queryClient.invalidateQueries({ queryKey: ['overrides', taxCardPayslipJobId] })
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setTaxCardPayslipData(null)
      setTaxCardPayslipJobId(null)
      toast.success('Tax card updated from payslip')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to save tax card')
    },
  })

  const deleteOverrideMutation = useMutation({
    mutationFn: ({ jobId, overrideId }: { jobId: string; overrideId: string }) =>
      api.delete(`/jobs/${jobId}/overrides/${overrideId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })
      toast.success('Override deleted')
    },
  })

  const payslipConfirmMutation = useMutation({
    mutationFn: ({ jobId, extraction }: { jobId: string; extraction: PayslipExtraction }) =>
      api.post(`/jobs/${jobId}/overrides`, {
        year: extraction.period.year,
        month: extraction.period.month,
        grossAmount: extraction.grossSalary,
        netAmount: extraction.netPay,
        note: `Imported from payslip${extraction.employerName ? ` — ${extraction.employerName}` : ''}`,
        payslipLines: extraction.lines,
        ...(extraction.pensionEmployerMonthly ? { pensionEmployerMonthly: extraction.pensionEmployerMonthly } : {}),
        deductionsSource: 'PAYSLIP_IMPORT',
      }),
    onError: (err) => {
      if (axios.isAxiosError(err)) toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to import payslip')
    },
  })

  async function handlePayslipConfirm(extraction: PayslipExtraction, taxCard?: TaxCardDraft) {
    const jobId = payslipReviewJobId!
    try {
      await payslipConfirmMutation.mutateAsync({ jobId, extraction })
      queryClient.invalidateQueries({ queryKey: ['all-overrides'] })

      if (taxCard) {
        try {
          await api.post(`/jobs/${jobId}/taxcard`, taxCard)
          queryClient.invalidateQueries({ queryKey: ['taxcards'] })
          queryClient.invalidateQueries({ queryKey: ['salary', jobId] })
          queryClient.invalidateQueries({ queryKey: ['overrides', jobId] })
          queryClient.invalidateQueries({ queryKey: ['jobs'] })
          toast.success('Payslip imported and tax card updated')
        } catch (taxErr) {
          toast.warning('Payslip saved, but tax card update failed')
        }
      } else {
        toast.success('Payslip imported')
      }

      setPayslipReviewData(null)
      setPayslipReviewJobId(null)
    } catch {
      // error toast handled by mutation's onError
    }
  }

  const createBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.post(`/jobs/${bonusJobId}/bonuses`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
        ...(data.currencyCode && data.currencyCode !== baseCurrency ? { currencyCode: data.currencyCode } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bonuses'] })
      setBonusJobId(null); setBonusForm(emptyBonus(baseCurrency)); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.put(`/jobs/${editingBonus!.jobId}/bonuses/${editingBonus!.id}`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bonuses'] })
      setEditingBonus(null); setBonusForm(emptyBonus(baseCurrency)); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteBonusMutation = useMutation({
    mutationFn: ({ jobId, bonusId }: { jobId: string; bonusId: string }) =>
      api.delete(`/jobs/${jobId}/bonuses/${bonusId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-bonuses'] }); toast.success('Bonus deleted') },
  })

  const allocMutation = useMutation({
    mutationFn: ({ jobId, householdId, pct }: { jobId: string; householdId: string; pct: number }) =>
      pct === 0
        ? api.delete(`/income/${jobId}/allocations/${householdId}`)
        : api.put(`/income/${jobId}/allocations/${householdId}`, { allocationPct: pct }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); setPendingAllocations({}); setAllocationsDirty(false); setAllocError(''); toast.success('Allocations saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setAllocError((err.response?.data as { error?: string })?.error ?? 'Failed to save allocation') },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  function computeManualNet(gross: number, calc: LiveDeductions, overrides: DeductionOverrides): number {
    const pension = parseFloat(overrides.pensionEmployeeAmount) || calc.pensionEmployee
    const atp = parseFloat(overrides.atpAmount) || calc.atp
    const amBidrag = parseFloat(overrides.amBidragAmount) || calc.amBidrag
    const aSkat = parseFloat(overrides.aSkattAmount) || calc.aSkat
    return r2(gross - calc.bruttoTotal - pension - atp - amBidrag - aSkat)
  }

  function buildPayslipLines(calc: LiveDeductions, overrides: DeductionOverrides) {
    type LineType = 'benefit_in_kind' | 'pre_am' | 'am_bidrag' | 'a_skat' | 'post_tax'
    const lines: { label: string; amount: number; type: LineType; sankeyGroup?: string; isCalculated: boolean }[] = []
    for (const item of calc.bruttoItems) {
      lines.push({ label: item.label, amount: item.monthlyAmount, type: 'pre_am', sankeyGroup: 'brutto_benefits', isCalculated: true })
    }
    const pension = parseFloat(overrides.pensionEmployeeAmount) || 0
    if (pension > 0 || calc.pensionEmployee > 0) {
      lines.push({ label: 'Pension (employee)', amount: pension || calc.pensionEmployee, type: 'pre_am', sankeyGroup: 'pension_employee', isCalculated: !overrides.pensionEmployeeAmount })
    }
    const atpVal = parseFloat(overrides.atpAmount) || 0
    lines.push({ label: 'ATP', amount: atpVal || calc.atp, type: 'pre_am', sankeyGroup: 'atp', isCalculated: !overrides.atpAmount })
    const amBidragVal = parseFloat(overrides.amBidragAmount) || 0
    lines.push({ label: 'AM-bidrag (8%)', amount: amBidragVal || calc.amBidrag, type: 'am_bidrag', sankeyGroup: 'am_bidrag', isCalculated: !overrides.amBidragAmount })
    const aSkatVal = parseFloat(overrides.aSkattAmount) || 0
    lines.push({ label: 'A-skat', amount: aSkatVal || calc.aSkat, type: 'a_skat', sankeyGroup: 'a_skat', isCalculated: !overrides.aSkattAmount })
    return lines
  }

  function getAllocationPct(job: Job, householdId: string): string {
    const key = `${job.id}:${householdId}`
    if (key in pendingAllocations) return pendingAllocations[key]
    const alloc = job.allocations.find((a) => a.budgetYear.household.id === householdId)
    return alloc ? alloc.allocationPct : '0'
  }

  function saveAllocations(job: Job) {
    setAllocError('')
    const dirty = Object.entries(pendingAllocations).filter(([key]) => key.startsWith(`${job.id}:`))
    if (dirty.length === 0) return
    for (const [key, value] of dirty) {
      const householdId = key.split(':')[1]
      allocMutation.mutate({ jobId: job.id, householdId, pct: parseFloat(value) || 0 })
    }
  }

  function openEditJob(job: Job) {
    setJobForm({ name: job.name, employer: job.employer ?? '', country: job.country ?? 'DK', startDate: toDateInput(job.startDate), endDate: job.endDate ? toDateInput(job.endDate) : '' })
    setJobFormError('')
    setEditingJob(job)
  }

  function handleJobSubmit(e: FormEvent) {
    e.preventDefault(); setJobFormError('')
    if (editingJob) updateJobMutation.mutate(jobForm)
    else createJobMutation.mutate(jobForm)
  }

  // ── DK tax card context ───────────────────────────────────────────────────

  const salaryJob = jobs.find((j) => j.id === salaryJobId) ?? null
  const overrideJob = jobs.find((j) => j.id === overrideJobId) ?? null

  const activeTaxCard = useMemo((): TaxCardSettings | null => {
    if (!salaryJobId) return null
    const cards = taxCards[salaryJobId] ?? []
    return cards.length > 0 ? cards[0] : null
  }, [salaryJobId, taxCards])

  const overrideActiveTaxCard = useMemo((): TaxCardSettings | null => {
    if (!overrideJobId) return null
    const cards = taxCards[overrideJobId] ?? []
    return cards.length > 0 ? cards[0] : null
  }, [overrideJobId, taxCards])

  const salaryLiveCalc = useMemo((): LiveDeductions | null => {
    const gross = parseFloat(salaryForm.grossAmount)
    if (!salaryJob || salaryJob.country !== 'DK' || !activeTaxCard || !gross) return null
    return calcDanishDeductions(gross, {
      traekprocent: parseFloat(activeTaxCard.traekprocent),
      personfradragMonthly: parseFloat(activeTaxCard.personfradragMonthly),
      pensionEmployeePct: activeTaxCard.pensionEmployeePct ? parseFloat(activeTaxCard.pensionEmployeePct) : null,
      pensionEmployerPct: activeTaxCard.pensionEmployerPct ? parseFloat(activeTaxCard.pensionEmployerPct) : null,
      atpAmount: activeTaxCard.atpAmount ? parseFloat(activeTaxCard.atpAmount) : null,
      bruttoItems: activeTaxCard.bruttoItems,
    })
  }, [salaryForm.grossAmount, salaryJob, activeTaxCard])

  const overrideLiveCalc = useMemo((): LiveDeductions | null => {
    const gross = parseFloat(overrideForm.grossAmount)
    if (!overrideJob || overrideJob.country !== 'DK' || !overrideActiveTaxCard || !gross) return null
    return calcDanishDeductions(gross, {
      traekprocent: parseFloat(overrideActiveTaxCard.traekprocent),
      personfradragMonthly: parseFloat(overrideActiveTaxCard.personfradragMonthly),
      pensionEmployeePct: overrideActiveTaxCard.pensionEmployeePct ? parseFloat(overrideActiveTaxCard.pensionEmployeePct) : null,
      pensionEmployerPct: overrideActiveTaxCard.pensionEmployerPct ? parseFloat(overrideActiveTaxCard.pensionEmployerPct) : null,
      atpAmount: overrideActiveTaxCard.atpAmount ? parseFloat(overrideActiveTaxCard.atpAmount) : null,
      bruttoItems: overrideActiveTaxCard.bruttoItems,
    })
  }, [overrideForm.grossAmount, overrideJob, overrideActiveTaxCard])

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = (historyData?.buckets ?? []).map((b) => ({
    period: b.period,
    net: parseFloat(b.net.toFixed(2)),
    gross: parseFloat(b.gross.toFixed(2)),
    bonuses: parseFloat(b.bonuses.reduce((s, x) => s + (showGross ? x.gross : x.net), 0).toFixed(2)),
  }))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <PageHeader title="Personal Income" subtitle="Manage your income sources and household allocations." />

        {/* ── Proxy banner ────────────────────────────────────────────────── */}
        {isProxy && proxyUserName && (
          <div className="bg-amber-950 border border-amber-700 text-amber-300 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <span>⚠ Entering income on behalf of <strong>{proxyUserName}</strong></span>
          </div>
        )}

        {/* ── Income History Chart ─────────────────────────────────────────── */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-semibold">Income History</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">From</label>
                <input type="month" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">To</label>
                <input type="month" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                {(['monthly', 'quarterly', 'yearly'] as Granularity[]).map((g) => (
                  <button key={g} onClick={() => setGranularity(g)}
                    className={`px-3 py-1.5 transition-colors ${granularity === g ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                <button onClick={() => setShowGross(false)}
                  className={`px-3 py-1.5 transition-colors ${!showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Net</button>
                <button onClick={() => setShowGross(true)}
                  className={`px-3 py-1.5 transition-colors ${showGross ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Gross</button>
              </div>
            </div>
          </div>

          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data for selected period</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="period" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
                  itemStyle={{ color: '#d1d5db' }}
                  formatter={(value: number) => fmt(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar dataKey="bonuses" name="Bonuses" fill="#d97706" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey={showGross ? 'gross' : 'net'} name={showGross ? 'Gross income' : 'Net income'} stroke="#fbbf24" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div>
          <div className="flex border-b border-gray-800 mb-6">
            {([['jobs', 'Jobs & Salary'], ['overrides', 'Monthly Overrides'], ['bonuses', 'Bonuses']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Jobs & Salary tab ─────────────────────────────────────────── */}
          {activeTab === 'jobs' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Jobs & Salary</h2>
                <button onClick={() => { setShowAddJob(true); setJobForm(emptyJob); setJobFormError('') }}
                  className="bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                  + Add job
                </button>
              </div>

              {isLoading ? (
                <PageLoader />
              ) : jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <p className="text-lg mb-2">No work on the horizon yet</p>
                  <p className="text-sm">Add a job to start tracking your salary history.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => (
                    <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                      {/* Job header */}
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-white font-semibold text-base">{job.name}</h3>
                            {job.isActive
                              ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Active</span>
                              : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">Ended</span>
                            }
                          </div>
                          {job.employer && <p className="text-gray-400 text-sm mt-0.5">{job.employer}</p>}
                          <p className="text-gray-500 text-xs mt-1">
                            {fmtDate(job.startDate)}{job.endDate ? ` – ${fmtDate(job.endDate)}` : ' – present'}
                          </p>
                          {job.latestSalary && (
                            <p className="text-amber-400 text-sm font-medium mt-1">
                              Net {fmt(job.latestSalary.netAmount)} / month
                              <span className="text-gray-500 text-xs font-normal ml-2">(gross {fmt(job.latestSalary.grossAmount)})</span>
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => { setSalaryJobId(job.id); setSalaryForm(emptySalary(baseCurrency)); setSalaryError('') }}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Salary history</button>
                          <button onClick={() => openEditJob(job)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                          {job.isActive && (
                            <button onClick={() => setConfirmCloseJob(job)}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors">Close</button>
                          )}
                        </div>
                      </div>

                      {/* Tax card settings (DK only) */}
                      {job.country === 'DK' && (
                        <TaxCardSection
                          jobId={job.id}
                          cards={taxCards[job.id] ?? []}
                          isExpanded={taxCardJobId === job.id}
                          onToggle={() => setTaxCardJobId((prev) => prev === job.id ? null : job.id)}
                          showForm={taxCardJobId === job.id && showTaxCardForm}
                          editingCardId={editingTaxCardId}
                          onShowForm={() => { setEditingTaxCardId(null); setShowTaxCardForm(true); setTaxCardForm(emptyTaxCard()) }}
                          onEditCard={(card) => {
                            setEditingTaxCardId(card.id)
                            setShowTaxCardForm(true)
                            setTaxCardForm({
                              effectiveFrom: new Date(card.effectiveFrom).toISOString().slice(0, 10),
                              traekprocent: card.traekprocent,
                              personfradragMonthly: card.personfradragMonthly,
                              municipality: card.municipality ?? '',
                              pensionEmployeePct: card.pensionEmployeePct ?? '',
                              pensionEmployerPct: card.pensionEmployerPct ?? '',
                              atpAmount: card.atpAmount ?? '',
                              bruttoItems: card.bruttoItems?.map((b) => ({ label: b.label, monthlyAmount: String(b.monthlyAmount) })) ?? [],
                            })
                          }}
                          onHideForm={() => { setShowTaxCardForm(false); setEditingTaxCardId(null) }}
                          onImportFromPayslip={() => {
                            setTaxCardPayslipJobId(job.id)
                            setTaxCardJobId(job.id)
                          }}
                          form={taxCardForm}
                          onFormChange={setTaxCardForm}
                          onSubmit={(e) => {
                            e.preventDefault()
                            editingTaxCardId
                              ? updateTaxCardMutation.mutate(taxCardForm)
                              : createTaxCardMutation.mutate(taxCardForm)
                          }}
                          isPending={createTaxCardMutation.isPending || updateTaxCardMutation.isPending}
                          error={taxCardError}
                          fmt={fmt}
                        />
                      )}

                      {/* Allocations */}
                      {households.length > 0 && (
                        <div className="border-t border-gray-800 pt-4">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Household allocations</p>
                          <div className="space-y-2">
                            {households.map((h) => {
                              const pctStr = getAllocationPct(job, h.id)
                              const pct = parseFloat(pctStr) || 0
                              const net = job.latestSalary ? parseFloat(job.latestSalary.netAmount) * pct / 100 : 0
                              return (
                                <div key={h.id} className="flex items-center gap-3">
                                  <span className="text-sm text-gray-300 w-44 truncate">{h.name}</span>
                                  <div className="flex items-center gap-2 flex-1">
                                    <input type="number" value={pctStr}
                                      onChange={(e) => { setPendingAllocations((prev) => ({ ...prev, [`${job.id}:${h.id}`]: e.target.value })); setAllocationsDirty(true) }}
                                      min="0" max="999" step="1"
                                      className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums" />
                                    <span className="text-gray-500 text-sm">%</span>
                                    {pct > 0 && job.latestSalary && (
                                      <span className="text-gray-400 text-xs tabular-nums">= {fmt(net)} / mo net</span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {(() => {
                            const totalPct = Object.entries(pendingAllocations)
                              .filter(([k]) => k.startsWith(`${job.id}:`))
                              .reduce((acc, [, v]) => acc + (Number(v) || 0), 0)
                            const isOver = totalPct !== 100 && allocationsDirty && Object.keys(pendingAllocations).some((k) => k.startsWith(`${job.id}:`))
                            return allocationsDirty && Object.keys(pendingAllocations).some((k) => k.startsWith(`${job.id}:`)) ? (
                              <div className="mt-3 flex items-center gap-3 flex-wrap">
                                <button onClick={() => saveAllocations(job)} disabled={allocMutation.isPending || isOver}
                                  className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5 rounded transition-colors">
                                  {allocMutation.isPending ? 'Saving…' : 'Save allocations'}
                                </button>
                                <button onClick={() => { setPendingAllocations((p) => {
                                  const next = { ...p }
                                  Object.keys(next).filter((k) => k.startsWith(`${job.id}:`)).forEach((k) => delete next[k])
                                  return next
                                }); setAllocationsDirty(false) }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Discard</button>
                                {isOver && <span className="text-amber-400 text-xs">Total is {totalPct}% — must equal 100%</span>}
                                {allocError && <span className="text-red-400 text-xs">{allocError}</span>}
                              </div>
                            ) : null
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Monthly Overrides tab ────────────────────────────────────────── */}
          {activeTab === 'overrides' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Monthly Overrides</h2>
                <p className="text-xs text-gray-500">Override a specific month's salary for any job</p>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">Add a job first to create overrides.</div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => {
                    const overrides = allJobsOverrides[job.id] ?? []
                    return (
                      <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-white font-medium">{job.name}</h3>
                            {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setPayslipImportJobId(job.id) }}
                              className="text-xs text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                              Import payslip
                            </button>
                            <button onClick={() => { setOverrideJobId(job.id); setOverrideForm(emptyOverride); setOverrideError('') }}
                              className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                              + Add override
                            </button>
                          </div>
                        </div>

                        {overrides.length === 0 ? (
                          <p className="text-gray-600 text-sm">No overrides for this job.</p>
                        ) : (
                          <div className="overflow-x-auto">
                          <table className="w-full text-sm min-w-[480px]">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                                <th className="pb-2 pr-4">Month</th>
                                <th className="pb-2 pr-4">Gross</th>
                                <th className="pb-2 pr-4">Net</th>
                                <th className="pb-2 pr-4">Note</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {overrides.map((o) => (
                                <tr key={o.id} className="border-b border-gray-800/50 last:border-0">
                                  <td className="py-2 pr-4 text-white">
                                    <div className="flex items-center gap-2">
                                      <span>{MONTHS[o.month - 1]} {o.year}</span>
                                      {o.deductionsSource && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded border ${
                                          o.deductionsSource === 'PAYSLIP_IMPORT'
                                            ? 'bg-green-900/50 text-green-300 border-green-700'
                                            : 'bg-blue-900/50 text-blue-300 border-blue-700'
                                        }`}>
                                          {o.deductionsSource === 'PAYSLIP_IMPORT' ? 'Payslip imported' : 'Payslip entered'}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(o.grossAmount)}</td>
                                  <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(o.netAmount)}</td>
                                  <td className="py-2 pr-4 text-gray-500 text-xs">{o.note ?? '—'}</td>
                                  <td className="py-2">
                                    <button onClick={() => setConfirmDeleteOverride({ jobId: job.id, overrideId: o.id })}
                                      className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Bonuses tab ──────────────────────────────────────────────────── */}
          {activeTab === 'bonuses' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Bonuses</h2>
                <p className="text-xs text-gray-500">Track one-off and spread-annually bonuses</p>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">Add a job first to track bonuses.</div>
              ) : (
                <div className="space-y-5">
                  {jobs.map((job) => {
                    const bonuses = allJobsBonuses[job.id] ?? []
                    return (
                      <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-white font-medium">{job.name}</h3>
                            {job.employer && <p className="text-gray-500 text-xs">{job.employer}</p>}
                          </div>
                          <button onClick={() => { setBonusJobId(job.id); setBonusForm(emptyBonus(baseCurrency)); setBonusError('') }}
                            className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                            + Add bonus
                          </button>
                        </div>

                        {bonuses.length === 0 ? (
                          <p className="text-gray-600 text-sm">No bonuses for this job.</p>
                        ) : (
                          <div className="overflow-x-auto">
                          <table className="w-full text-sm min-w-[560px]">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                                <th className="pb-2 pr-4">Label</th>
                                <th className="pb-2 pr-4">Payment date</th>
                                <th className="pb-2 pr-4">Net</th>
                                <th className="pb-2 pr-4">In budget</th>
                                <th className="pb-2 pr-4">Mode</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {bonuses.map((b) => (
                                <tr key={b.id} className="border-b border-gray-800/50 last:border-0">
                                  <td className="py-2 pr-4 text-white">{b.label}</td>
                                  <td className="py-2 pr-4 text-gray-300">{fmtDate(b.paymentDate)}</td>
                                  <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(b.netAmount)}</td>
                                  <td className="py-2 pr-4">
                                    {b.includeInBudget
                                      ? <span className="text-xs bg-green-900 text-green-400 border border-green-700 px-2 py-0.5 rounded">Yes</span>
                                      : <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded">No</span>
                                    }
                                  </td>
                                  <td className="py-2 pr-4 text-gray-400 text-xs">
                                    {b.budgetMode === 'ONE_OFF' ? 'One-off' : b.budgetMode === 'SPREAD_ANNUALLY' ? 'Spread / year' : '—'}
                                  </td>
                                  <td className="py-2">
                                    <div className="flex gap-3">
                                      <button onClick={() => { setEditingBonus(b); setBonusForm({ label: b.label, grossAmount: b.grossAmount, netAmount: b.netAmount, paymentDate: toDateInput(b.paymentDate), includeInBudget: b.includeInBudget, budgetMode: b.budgetMode ?? '', currencyCode: b.currencyCode ?? baseCurrency }); setBonusError('') }}
                                        className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                                      <button onClick={() => setConfirmDeleteBonus({ jobId: job.id, bonusId: b.id })}
                                        className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Add/Edit Job modal ──────────────────────────────────────────────── */}
      {(showAddJob || editingJob) && (
        <Modal title={editingJob ? 'Edit job' : 'Add job'} onClose={() => { setShowAddJob(false); setEditingJob(null) }}>
          <form onSubmit={handleJobSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Job title</label>
              <input type="text" value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                required autoFocus placeholder="e.g. Software Engineer" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Employer <span className="text-gray-600">(optional)</span></label>
              <input type="text" value={jobForm.employer} onChange={(e) => setJobForm({ ...jobForm, employer: e.target.value })}
                placeholder="e.g. Acme Corp" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Country</label>
              <select value={jobForm.country} onChange={(e) => setJobForm({ ...jobForm, country: e.target.value })} className={inputClass}>
                <option value="DK">DK — Denmark</option>
                <option value="OTHER">Other (generic)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Start date</label>
                <input type="date" value={jobForm.startDate} onChange={(e) => setJobForm({ ...jobForm, startDate: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">End date <span className="text-gray-600">(optional)</span></label>
                <input type="date" value={jobForm.endDate} onChange={(e) => setJobForm({ ...jobForm, endDate: e.target.value })}
                  className={inputClass} />
              </div>
            </div>
            {jobFormError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{jobFormError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={createJobMutation.isPending || updateJobMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {createJobMutation.isPending || updateJobMutation.isPending ? 'Saving…' : editingJob ? 'Save changes' : 'Add job'}
              </button>
              <button type="button" onClick={() => { setShowAddJob(false); setEditingJob(null) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Salary History modal ────────────────────────────────────────────── */}
      {salaryJobId && (
        <Modal title={`Salary history — ${jobs.find((j) => j.id === salaryJobId)?.name}`} onClose={() => { setSalaryJobId(null); setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryError('') }} size="lg">
          {/* Existing records */}
          {salaryRecords.length > 0 && (
            <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                  <th className="pb-2 pr-4">Effective from</th>
                  <th className="pb-2 pr-4">Gross / month</th>
                  <th className="pb-2 pr-4">Net / month</th>
                  <th className="pb-2 pr-4">Currency</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {salaryRecords.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-2 pr-4 text-gray-300">{fmtDate(r.effectiveFrom)}</td>
                    <td className="py-2 pr-4 text-gray-300 tabular-nums">{fmt(r.grossAmount)}</td>
                    <td className="py-2 pr-4 text-amber-400 tabular-nums">{fmt(r.netAmount)}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{r.currencyCode ?? baseCurrency}</td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => { setEditingSalary(r); setSalaryForm({ grossAmount: r.grossAmount, netAmount: r.netAmount, effectiveFrom: r.effectiveFrom.slice(0, 10), currencyCode: r.currencyCode ?? baseCurrency }); setSalaryError('') }}
                        className="text-xs text-gray-400 hover:text-white transition-colors mr-3"
                      >Edit</button>
                      <button
                        onClick={() => deleteSalaryMutation.mutate(r.id)}
                        disabled={deleteSalaryMutation.isPending}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors"
                      >Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {/* Add / Edit record */}
          <h3 className="text-sm font-medium text-gray-400 mb-3">{editingSalary ? 'Edit salary record' : 'Add salary record'}</h3>
          <form onSubmit={(e) => { e.preventDefault(); const payload = { form: salaryForm, deductionOverrides: salaryDeductionOverrides, liveCalc: salaryLiveCalc }; editingSalary ? updateSalaryMutation.mutate(payload) : addSalaryMutation.mutate(payload) }} className="space-y-3">
            <div className={`grid gap-3 ${salaryJob?.country === 'DK' ? 'grid-cols-3' : 'grid-cols-4'}`}>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Effective from</label>
                <input type="date" value={salaryForm.effectiveFrom} onChange={(e) => setSalaryForm({ ...salaryForm, effectiveFrom: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
                <input type="number" value={salaryForm.grossAmount} onChange={(e) => setSalaryForm({ ...salaryForm, grossAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              {salaryJob?.country !== 'DK' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
                  <input type="number" value={salaryForm.netAmount} onChange={(e) => setSalaryForm({ ...salaryForm, netAmount: e.target.value })}
                    required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
                <select value={salaryForm.currencyCode} onChange={(e) => setSalaryForm({ ...salaryForm, currencyCode: e.target.value })}
                  className={inputClass}>
                  <option value={baseCurrency}>{baseCurrency}</option>
                  {currencies.filter((c) => c.code !== baseCurrency).map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
              </div>
            </div>
            {salaryForm.currencyCode && salaryForm.currencyCode !== baseCurrency && salaryForm.netAmount && (
              <p className="text-xs text-gray-500">
                ≈ {(parseFloat(salaryForm.netAmount) * (currencies.find((c) => c.code === salaryForm.currencyCode)?.rate ?? 1)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency} / month net
              </p>
            )}

            {/* DK deduction breakdown panel */}
            {salaryJob?.country === 'DK' && (
              <DeductionPanel
                gross={parseFloat(salaryForm.grossAmount) || 0}
                liveCalc={salaryLiveCalc}
                overrides={salaryDeductionOverrides}
                onOverrideChange={(field, val) => setSalaryDeductionOverrides((prev) => ({ ...prev, [field]: val }))}
                hasTaxCard={!!activeTaxCard}
                baseCurrency={baseCurrency}
              />
            )}

            {salaryError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{salaryError}</div>}
            <div className="flex items-center gap-3">
              <button type="submit" disabled={addSalaryMutation.isPending || updateSalaryMutation.isPending}
                className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                {addSalaryMutation.isPending || updateSalaryMutation.isPending ? 'Saving…' : editingSalary ? 'Save changes' : 'Add record'}
              </button>
              {editingSalary && (
                <button type="button" onClick={() => { setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('') }}
                  className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add Override modal ──────────────────────────────────────────────── */}
      {overrideJobId && (
        <Modal title={`Add monthly override — ${jobs.find((j) => j.id === overrideJobId)?.name}`} onClose={() => { setOverrideJobId(null); setOverrideDeductionOpen(false); setOverrideDeductionOverrides(emptyDeductionOverrides()) }}>
          <form onSubmit={(e) => { e.preventDefault(); upsertOverrideMutation.mutate({ form: overrideForm, deductionOverrides: overrideDeductionOverrides, liveCalc: overrideLiveCalc }) }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
                <input type="number" value={overrideForm.year} onChange={(e) => setOverrideForm({ ...overrideForm, year: e.target.value })}
                  required min="2000" max="2100" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
                <select value={overrideForm.month} onChange={(e) => setOverrideForm({ ...overrideForm, month: e.target.value })} className={inputClass}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className={`grid gap-4 ${overrideJob?.country === 'DK' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <div className={overrideJob?.country === 'DK' ? 'grid grid-cols-2 gap-4' : ''}>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
                  <input type="number" value={overrideForm.grossAmount} onChange={(e) => setOverrideForm({ ...overrideForm, grossAmount: e.target.value })}
                    required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
                </div>
                {overrideJob?.country !== 'DK' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Net / month</label>
                    <input type="number" value={overrideForm.netAmount} onChange={(e) => setOverrideForm({ ...overrideForm, netAmount: e.target.value })}
                      required={overrideJob?.country !== 'DK'} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Note <span className="text-gray-600">(optional)</span></label>
              <input type="text" value={overrideForm.note} onChange={(e) => setOverrideForm({ ...overrideForm, note: e.target.value })}
                placeholder="e.g. Sick leave, parental leave" className={inputClass} />
            </div>

            {/* Deduction breakdown for DK jobs */}
            {overrideJob?.country === 'DK' && (
              <div className="border border-gray-700 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setOverrideDeductionOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                  <span>Deduction breakdown</span>
                  <span className="text-xs">{overrideDeductionOpen ? '▲' : '▼'}</span>
                </button>
                {overrideDeductionOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <DeductionPanel
                      gross={parseFloat(overrideForm.grossAmount) || 0}
                      liveCalc={overrideLiveCalc}
                      overrides={overrideDeductionOverrides}
                      onOverrideChange={(field, val) => setOverrideDeductionOverrides((prev) => ({ ...prev, [field]: val }))}
                      hasTaxCard={!!overrideActiveTaxCard}
                      baseCurrency={baseCurrency}
                    />
                  </div>
                )}
              </div>
            )}

            {overrideError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{overrideError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={upsertOverrideMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {upsertOverrideMutation.isPending ? 'Saving…' : 'Save override'}
              </button>
              <button type="button" onClick={() => { setOverrideJobId(null); setOverrideDeductionOpen(false); setOverrideDeductionOverrides(emptyDeductionOverrides()) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add/Edit Bonus modal ────────────────────────────────────────────── */}
      {(bonusJobId || editingBonus) && (
        <Modal title={editingBonus ? 'Edit bonus' : `Add bonus — ${jobs.find((j) => j.id === bonusJobId)?.name}`} onClose={() => { setBonusJobId(null); setEditingBonus(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); if (editingBonus) updateBonusMutation.mutate(bonusForm); else createBonusMutation.mutate(bonusForm) }} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
              <input type="text" value={bonusForm.label} onChange={(e) => setBonusForm({ ...bonusForm, label: e.target.value })}
                required autoFocus placeholder="e.g. Annual bonus" className={inputClass} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Payment date</label>
                <input type="date" value={bonusForm.paymentDate} onChange={(e) => setBonusForm({ ...bonusForm, paymentDate: e.target.value })}
                  required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Gross amount</label>
                <input type="number" value={bonusForm.grossAmount} onChange={(e) => setBonusForm({ ...bonusForm, grossAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Net amount</label>
                <input type="number" value={bonusForm.netAmount} onChange={(e) => setBonusForm({ ...bonusForm, netAmount: e.target.value })}
                  required min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Currency</label>
                <select value={bonusForm.currencyCode} onChange={(e) => setBonusForm({ ...bonusForm, currencyCode: e.target.value })}
                  className={inputClass}>
                  <option value={baseCurrency}>{baseCurrency}</option>
                  {currencies.filter((c) => c.code !== baseCurrency).map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
              </div>
            </div>
            {bonusForm.currencyCode && bonusForm.currencyCode !== baseCurrency && bonusForm.netAmount && (
              <p className="text-xs text-gray-500">
                ≈ {(parseFloat(bonusForm.netAmount) * (currencies.find((c) => c.code === bonusForm.currencyCode)?.rate ?? 1)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency} net
              </p>
            )}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bonusForm.includeInBudget} onChange={(e) => setBonusForm({ ...bonusForm, includeInBudget: e.target.checked })}
                  className="rounded border-gray-600" />
                <span className="text-sm text-gray-300">Include in budget calculations</span>
              </label>
            </div>
            {bonusForm.includeInBudget && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">Budget mode</label>
                <div className="flex gap-3">
                  {(['ONE_OFF', 'SPREAD_ANNUALLY'] as BudgetMode[]).map((val) => {
                    const label = val === 'ONE_OFF' ? 'One-off (appears in payment month)' : 'Spread annually (÷12 per month)'
                    return (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" value={val} checked={bonusForm.budgetMode === val} onChange={() => setBonusForm({ ...bonusForm, budgetMode: val })}
                        className="border-gray-600" />
                      <span className="text-sm text-gray-300">{label}</span>
                    </label>
                    )
                  })}
                </div>
              </div>
            )}
            {bonusError && <div className="bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{bonusError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={createBonusMutation.isPending || updateBonusMutation.isPending}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
                {createBonusMutation.isPending || updateBonusMutation.isPending ? 'Saving…' : editingBonus ? 'Save changes' : 'Add bonus'}
              </button>
              <button type="button" onClick={() => { setBonusJobId(null); setEditingBonus(null) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Confirm close job ───────────────────────────────────────────────── */}
      {confirmCloseJob && (
        <Modal title="Close job" onClose={() => setConfirmCloseJob(null)} size="sm">
          <p className="text-gray-300 text-sm mb-6">
            Close <span className="font-semibold text-white">{confirmCloseJob.name}</span>? This will set today as the end date. You can re-open it by editing the job.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { closeJobMutation.mutate(confirmCloseJob.id); setConfirmCloseJob(null) }}
              disabled={closeJobMutation.isPending}
              className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Close job
            </button>
            <button onClick={() => setConfirmCloseJob(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Confirm delete bonus ────────────────────────────────────────────── */}
      {confirmDeleteBonus && (
        <Modal title="Delete bonus" onClose={() => setConfirmDeleteBonus(null)} size="sm">
          <p className="text-gray-300 text-sm mb-6">Delete this bonus? This action cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { deleteBonusMutation.mutate(confirmDeleteBonus); setConfirmDeleteBonus(null) }}
              disabled={deleteBonusMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Delete
            </button>
            <button onClick={() => setConfirmDeleteBonus(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Confirm delete override ─────────────────────────────────────────── */}
      {/* ── Payslip Import modal ───────────────────────────────────────────── */}
      {payslipImportJobId && (
        <PayslipImportModal
          jobId={payslipImportJobId}
          jobName={jobs.find((j) => j.id === payslipImportJobId)?.name ?? ''}
          onClose={() => setPayslipImportJobId(null)}
          onExtracted={(data) => {
            setPayslipReviewData(data)
            setPayslipReviewJobId(payslipImportJobId)
            setPayslipImportJobId(null)
          }}
        />
      )}

      {/* ── Payslip Review modal ───────────────────────────────────────────── */}
      {payslipReviewData && payslipReviewJobId && (
        <PayslipReviewModal
          extraction={payslipReviewData}
          jobName={jobs.find((j) => j.id === payslipReviewJobId)?.name ?? ''}
          onClose={() => { setPayslipReviewData(null); setPayslipReviewJobId(null) }}
          onConfirm={handlePayslipConfirm}
          isPending={payslipConfirmMutation.isPending}
        />
      )}

      {/* ── Tax card import: payslip picker ───────────────────────────────── */}
      {taxCardPayslipJobId && !taxCardPayslipData && (
        <PayslipImportModal
          jobId={taxCardPayslipJobId}
          jobName={jobs.find((j) => j.id === taxCardPayslipJobId)?.name ?? ''}
          onClose={() => setTaxCardPayslipJobId(null)}
          onExtracted={(data) => setTaxCardPayslipData(data)}
        />
      )}

      {/* ── Tax card import: review & save ────────────────────────────────── */}
      {taxCardPayslipData && taxCardPayslipJobId && (
        <TaxCardFromPayslipModal
          extraction={taxCardPayslipData}
          jobName={jobs.find((j) => j.id === taxCardPayslipJobId)?.name ?? ''}
          onClose={() => { setTaxCardPayslipData(null); setTaxCardPayslipJobId(null) }}
          onConfirm={(taxCard) => taxCardFromPayslipMutation.mutate({ jobId: taxCardPayslipJobId, taxCard })}
          isPending={taxCardFromPayslipMutation.isPending}
        />
      )}

      {confirmDeleteOverride && (
        <Modal title="Delete override" onClose={() => setConfirmDeleteOverride(null)} size="sm">
          <p className="text-gray-300 text-sm mb-6">Delete this monthly override? This action cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { deleteOverrideMutation.mutate(confirmDeleteOverride); setConfirmDeleteOverride(null) }}
              disabled={deleteOverrideMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              Delete
            </button>
            <button onClick={() => setConfirmDeleteOverride(null)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
