import { Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from '../../components/CategoryIcon'
import { DetailPane, DetailRow, DetailSection } from '../../components/DetailPane'
import { monthRangeLabel } from './helpers'
import { MonthStrip, frequencyLabel } from './ExpensesTable'
import type { Expense } from './types'

interface ExpenseDetailProps {
  expense: Expense
  isReadOnly: boolean
  baseCurrency: string
  onClose: () => void
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  fmt: (v: number | string, suffix?: string) => string
}

/** Side-pane view of one expense (wide screens). All amounts come from the API as-is. */
export function ExpenseDetail({ expense: e, isReadOnly, baseCurrency, onClose, onEdit, onDelete, fmt }: ExpenseDetailProps) {
  const range = monthRangeLabel(e.startMonth, e.endMonth)
  const differentAverage = e.monthlyEquivalent !== e.monthlyWhenActive

  return (
    <DetailPane
      eyebrow="Expense"
      title={e.label}
      subtitle={
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {e.category.icon && <CategoryIcon name={e.category.icon} size={14} className="text-gray-500" />}
          {e.category.name} · {frequencyLabel(e)}{e.frequencyPeriod ? ` (${e.frequencyPeriod})` : ''}
        </span>
      }
      onClose={onClose}
      actions={isReadOnly ? undefined : (
        <>
          <button
            onClick={() => onEdit(e)}
            className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-3 py-2 rounded-lg transition-colors"
          >
            <Pencil size={14} /> Edit
          </button>
          <button
            onClick={() => onDelete(e)}
            className="inline-flex items-center gap-2 border border-gray-700 text-gray-300 hover:text-red-400 hover:border-red-800 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            <Trash2 size={14} /> Move to trash
          </button>
        </>
      )}
    >
      <DetailSection>
        <DetailRow label="Amount">
          {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
          {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
        </DetailRow>
        {e.currencyCode && (
          <DetailRow label={`In ${baseCurrency}`}>
            {fmt(e.amountInBase)}
            {e.rateUsed && <span className="block text-xs text-gray-500">rate {e.rateUsed}</span>}
          </DetailRow>
        )}
        <DetailRow label="Per month"><span className="text-amber-400 font-semibold">{fmt(e.monthlyWhenActive)}</span></DetailRow>
        {differentAverage && <DetailRow label="Averaged over the year">{fmt(e.monthlyEquivalent)}</DetailRow>}
        <DetailRow label="Active">{range ?? 'All year'}</DetailRow>
      </DetailSection>

      <DetailSection title="Months charged">
        <MonthStrip schedule={e.monthSchedule} fmt={fmt} />
      </DetailSection>

      <DetailSection title="Belongs to">
        {e.ownership === 'SHARED' && <p className="text-gray-300">Shared, split by income</p>}
        {e.ownership === 'INDIVIDUAL' && <p className="text-gray-300">{e.ownedBy?.name ?? 'One member'}</p>}
        {e.ownership === 'CUSTOM' && e.customSplits.map((s) => (
          <DetailRow key={s.userId} label={s.user.name}>{parseFloat(s.pct).toFixed(0)}%</DetailRow>
        ))}
        <DetailRow label="Account">{e.account?.name ?? '—'}</DetailRow>
      </DetailSection>

      {e.notes && (
        <DetailSection title="Notes">
          <p className="text-gray-300 whitespace-pre-wrap break-words">{e.notes}</p>
        </DetailSection>
      )}
    </DetailPane>
  )
}
