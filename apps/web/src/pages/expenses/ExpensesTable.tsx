import { Pencil, Trash } from 'lucide-react'
import { CategoryIcon } from '../../components/CategoryIcon'
import { DataTable, RowActionButton, type DataColumn } from '../../components/DataTable'
import { AccountBadge, OwnershipBadges } from '../../components/entries/EntryBadges'
import { ManualBadge } from '../../components/entries/PaymentMethodField'
import { FREQUENCIES } from '../../lib/constants'
import { MONTH_SHORT, monthRangeLabel } from './helpers'
import type { Expense, SortKey } from './types'

interface ExpensesTableProps {
  expenses: Expense[]
  isReadOnly: boolean
  /** Year of the viewed budget year, used to dim expenses that have already ended. */
  viewedYear: number | undefined
  sortKey: SortKey
  sortAsc: boolean
  onSort: (key: SortKey) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onOpen: (expense: Expense) => void
  /** Expense shown in the detail pane. */
  activeId: string | null
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  isFiltered: boolean
  totalMonthly: number
  fmt: (v: number | string, suffix?: string) => string
}

export const frequencyLabel = (e: Pick<Expense, 'frequency'>) => FREQUENCIES.find((f) => f.value === e.frequency)?.label ?? e.frequency

/** Jan–Dec: which months the expense is charged in (from the API's `monthSchedule`). */
export function MonthStrip({ schedule, fmt }: { schedule: (string | null)[]; fmt: (v: number | string) => string }) {
  return (
    <span className="inline-grid grid-cols-12 gap-0.5" aria-label="Months charged">
      {schedule.map((amount, i) => (
        <span
          key={i}
          title={`${MONTH_SHORT[i + 1]}: ${amount ? fmt(amount) : 'nothing due'}`}
          className={`block w-2.5 h-3.5 rounded-sm ${amount ? 'bg-amber-400/70' : 'bg-gray-800'}`}
        />
      ))}
    </span>
  )
}

/** Sortable, selectable expense list with a monthly total footer. */
export function ExpensesTable({
  expenses, isReadOnly, viewedYear, sortKey, sortAsc, onSort, selectedIds, onToggleSelect, onToggleSelectAll,
  onOpen, activeId, onEdit, onDelete, isFiltered, totalMonthly, fmt,
}: ExpensesTableProps) {
  // An expense has ended if its end month is behind today *in the viewed budget year*
  const now = new Date()
  const year = viewedYear ?? now.getFullYear()
  const isPast = (e: Expense) =>
    e.endMonth != null && (year < now.getFullYear() || (year === now.getFullYear() && e.endMonth < now.getMonth() + 1))

  const columns: DataColumn<Expense>[] = [
    {
      key: 'label', header: 'Label', sortKey: 'label',
      cell: (e) => {
        const rangeLabel = monthRangeLabel(e.startMonth, e.endMonth)
        return (
          <span className="flex items-center gap-2 flex-wrap text-white">
            {e.label}
            {rangeLabel && (
              <span className="text-xs bg-gray-700/60 text-gray-400 border border-gray-600/50 px-2 py-0.5 rounded-full">{rangeLabel}</span>
            )}
            {e.notes && <span className="text-gray-600 text-xs" title={e.notes}>📝</span>}
          </span>
        )
      },
      footer: <>Total{isFiltered ? ' (filtered)' : ''} — {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</>,
    },
    {
      key: 'category', header: 'Category', sortKey: 'category', priority: 2,
      cell: (e) => (
        <span className="flex items-center gap-1.5 text-gray-300">
          {e.category.icon && <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />}
          {e.category.name}
        </span>
      ),
      summary: (e) => e.category.name,
    },
    {
      key: 'frequency', header: 'Frequency', sortKey: 'frequency', priority: 2,
      cell: (e) => (
        <span className="text-gray-300">
          {frequencyLabel(e)}
          {e.frequencyPeriod && <span className="text-gray-500 text-xs ml-1">({e.frequencyPeriod})</span>}
        </span>
      ),
      summary: frequencyLabel,
    },
    {
      key: 'owner', header: 'Belongs to', priority: 3,
      cell: (e) => (
        <span className="flex items-center gap-1.5 flex-wrap">
          {e.ownership === 'SHARED' && <span className="text-xs text-gray-500">Shared</span>}
          <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
          <AccountBadge account={e.account} />
          <ManualBadge paymentMethod={e.paymentMethod} />
        </span>
      ),
      summary: (e) => (
        <>
          <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
          <AccountBadge account={e.account} />
          <ManualBadge paymentMethod={e.paymentMethod} />
        </>
      ),
    },
    {
      key: 'amount', header: 'Amount', sortKey: 'amount', priority: 3, align: 'right',
      cell: (e) => (
        <span className="text-gray-200 tabular-nums whitespace-nowrap">
          {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
          {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
        </span>
      ),
    },
    {
      key: 'months', header: 'Jan – Dec', priority: 5,
      cell: (e) => <MonthStrip schedule={e.monthSchedule} fmt={fmt} />,
    },
    {
      key: 'monthly', header: '/month', sortKey: 'monthly', align: 'right',
      cell: (e) => <span className="text-gray-100 tabular-nums font-medium whitespace-nowrap">{fmt(parseFloat(e.monthlyWhenActive))}</span>,
      footer: <span className="text-gray-100 font-bold tabular-nums whitespace-nowrap">{fmt(totalMonthly)}</span>,
    },
  ]

  return (
    <DataTable
      rows={expenses}
      columns={columns}
      sort={{ key: sortKey, asc: sortAsc, onSort: (key) => onSort(key as SortKey) }}
      selection={isReadOnly ? undefined : { selectedIds, onToggle: onToggleSelect, onToggleAll: onToggleSelectAll, label: (e) => e.label }}
      onRowClick={onOpen}
      activeId={activeId}
      rowActions={isReadOnly ? undefined : (e) => (
        <>
          <RowActionButton label={`Edit ${e.label}`} hideWhenNarrow onClick={() => onEdit(e)}><Pencil size={15} /></RowActionButton>
          <RowActionButton label={`Move ${e.label} to trash`} tone="danger" onClick={() => onDelete(e)}><Trash size={15} /></RowActionButton>
        </>
      )}
      rowClassName={(e) => (isPast(e) ? 'opacity-50' : '')}
    />
  )
}
