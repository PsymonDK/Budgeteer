import { Pencil, Trash } from 'lucide-react'
import { CategoryIcon } from '../../components/CategoryIcon'
import { DetailPane, DetailRow, DetailSection } from '../../components/DetailPane'
import { ordinalDay } from '../../components/entries/DueDayField'
import { savingsFrequencyLabel } from './SavingsTable'
import type { SavingsEntry } from './types'

interface SavingsDetailProps {
  entry: SavingsEntry
  isReadOnly: boolean
  baseCurrency: string
  onClose: () => void
  onEdit: (entry: SavingsEntry) => void
  onDelete: (entry: SavingsEntry) => void
  fmt: (v: number | string, suffix?: string) => string
}

/** Side-pane view of one savings entry (wide screens). All amounts come from the API as-is. */
export function SavingsDetail({ entry: e, isReadOnly, baseCurrency, onClose, onEdit, onDelete, fmt }: SavingsDetailProps) {
  return (
    <DetailPane
      eyebrow="Savings"
      title={e.label}
      subtitle={
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {e.category?.icon && <CategoryIcon name={e.category.icon} size={14} className="text-gray-500" />}
          {e.category?.name ?? 'No category'} · {savingsFrequencyLabel(e)}
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
            <Trash size={14} /> Move to trash
          </button>
        </>
      )}
    >
      <DetailSection>
        <DetailRow label="Amount">
          {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
          {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
        </DetailRow>
        {e.currencyCode && e.rateUsed && <DetailRow label="Rate used">{e.rateUsed}</DetailRow>}
        <DetailRow label={`Per month (${baseCurrency})`}><span className="text-amber-400 font-semibold">{fmt(e.monthlyEquivalent)}</span></DetailRow>
        {e.dueDay != null && <DetailRow label="Due">{ordinalDay(e.dueDay)} of the month</DetailRow>}
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
