import { Pencil, Trash } from 'lucide-react'
import { CategoryIcon } from '../../components/CategoryIcon'
import { DataTable, RowActionButton, type DataColumn } from '../../components/DataTable'
import { AccountBadge, OwnershipBadges } from '../../components/entries/EntryBadges'
import { FREQUENCIES } from '../../lib/constants'
import type { SavingsEntry } from './types'

interface SavingsTableProps {
  entries: SavingsEntry[]
  isReadOnly: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onOpen: (entry: SavingsEntry) => void
  /** Entry shown in the detail pane. */
  activeId: string | null
  onEdit: (entry: SavingsEntry) => void
  onDelete: (entry: SavingsEntry) => void
  isFiltered: boolean
  totalMonthly: number
  baseCurrency: string
  fmt: (v: number | string, suffix?: string) => string
}

export const savingsFrequencyLabel = (e: Pick<SavingsEntry, 'frequency'>) =>
  FREQUENCIES.find((f) => f.value === e.frequency)?.label ?? e.frequency

/** Selectable savings list with a monthly total footer. */
export function SavingsTable({
  entries, isReadOnly, selectedIds, onToggleSelect, onToggleSelectAll, onOpen, activeId,
  onEdit, onDelete, isFiltered, totalMonthly, baseCurrency, fmt,
}: SavingsTableProps) {
  const columns: DataColumn<SavingsEntry>[] = [
    {
      key: 'label', header: 'Label',
      cell: (e) => (
        <span className="flex items-center gap-2 flex-wrap text-white">
          {e.label}
          {e.notes && <span className="text-gray-600 text-xs" title={e.notes}>📝</span>}
        </span>
      ),
      footer: <>Total{isFiltered ? ' (filtered)' : ''} — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}</>,
    },
    {
      key: 'category', header: 'Category', priority: 2,
      cell: (e) => e.category ? (
        <span className="flex items-center gap-1.5 text-gray-300">
          {e.category.icon && <CategoryIcon name={e.category.icon} size={14} className="text-gray-500 shrink-0" />}
          {e.category.name}
        </span>
      ) : <span className="text-gray-600">—</span>,
      summary: (e) => e.category?.name,
    },
    {
      key: 'frequency', header: 'Frequency', priority: 2,
      cell: (e) => <span className="text-gray-300">{savingsFrequencyLabel(e)}</span>,
      summary: savingsFrequencyLabel,
    },
    {
      key: 'owner', header: 'Belongs to', priority: 3,
      cell: (e) => (
        <span className="flex items-center gap-1.5 flex-wrap">
          {e.ownership === 'SHARED' && <span className="text-xs text-gray-500">Shared</span>}
          <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
          <AccountBadge account={e.account} />
        </span>
      ),
      summary: (e) => (
        <>
          <OwnershipBadges ownership={e.ownership} ownedBy={e.ownedBy} />
          <AccountBadge account={e.account} />
        </>
      ),
    },
    {
      key: 'amount', header: 'Amount', priority: 3, align: 'right',
      cell: (e) => (
        <span className="text-gray-200 tabular-nums whitespace-nowrap">
          {fmt(parseFloat(e.originalAmount ?? e.amount), e.currencyCode ? '' : undefined)}
          {e.currencyCode && <span className="ml-1 text-xs text-blue-400">{e.currencyCode}</span>}
        </span>
      ),
    },
    {
      key: 'monthly', header: '/ month', align: 'right',
      cell: (e) => (
        <span className="text-amber-400 tabular-nums font-medium whitespace-nowrap">
          {fmt(parseFloat(e.monthlyEquivalent), '')}
          <span className="ml-1 text-xs text-gray-500">{baseCurrency}</span>
        </span>
      ),
      footer: <span className="text-amber-400 font-bold tabular-nums whitespace-nowrap">{fmt(totalMonthly)}</span>,
    },
  ]

  return (
    <DataTable
      rows={entries}
      columns={columns}
      selection={isReadOnly ? undefined : { selectedIds, onToggle: onToggleSelect, onToggleAll: onToggleSelectAll, label: (e) => e.label }}
      onRowClick={onOpen}
      activeId={activeId}
      rowActions={isReadOnly ? undefined : (e) => (
        <>
          <RowActionButton label={`Edit ${e.label}`} hideWhenNarrow onClick={() => onEdit(e)}><Pencil size={15} /></RowActionButton>
          <RowActionButton label={`Move ${e.label} to trash`} tone="danger" onClick={() => onDelete(e)}><Trash size={15} /></RowActionButton>
        </>
      )}
    />
  )
}
