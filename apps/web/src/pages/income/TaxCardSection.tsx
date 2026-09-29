import type { FormEvent } from 'react'
import type { TaxCardForm, TaxCardSettings } from './types'

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

export function TaxCardSection({ jobId: _jobId, cards, isExpanded, onToggle, showForm, editingCardId, onShowForm, onEditCard, onHideForm, onImportFromPayslip, form, onFormChange, onSubmit, isPending, error, fmt }: TaxCardSectionProps) {
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
