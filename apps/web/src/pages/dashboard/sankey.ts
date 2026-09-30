// Node/link builders for the dashboard Sankey diagrams. These only reshape the
// server's pre-aggregated totals for display.

import type { SankeyLinkDef, SankeyNodeDef } from '../../components/SankeyChart'
import type { DashboardSummary, IncomeFlowTarget } from './types'
import type { ReceiptConsumptionSummary } from '../../api/types'
import { ENTITY, personColor, seriesColor } from '../../lib/charts'

// Categories take the palette in order; past the sixth they share the neutral (their labels tell them apart)

/** VIZ-001: income flow from each member to expense categories, savings and surplus. */
export function buildIncomeSankey(summary: DashboardSummary | undefined) {
  const flow = summary?.budgetYear ? summary.incomeFlow : null
  if (!flow || flow.members.length === 0) return null
  const targetId = (t: IncomeFlowTarget) => (t.kind === 'category' ? `cat_${t.categoryId}` : t.kind)
  const categories = [...new Map(
    flow.links.flatMap((l) => (l.target.kind === 'category' ? [[l.target.categoryId, l.target.categoryName] as const] : [])),
  )]
  const hasTarget = (kind: 'savings' | 'surplus') => flow.links.some((l) => l.target.kind === kind)
  const nodes: SankeyNodeDef[] = [
    ...flow.members.map((m, i) => ({ id: `member_${m.userId}`, name: m.name, color: personColor(i) })),
    ...categories.map(([id, name], i) => ({ id: `cat_${id}`, name, color: seriesColor(i) })),
    ...(hasTarget('savings') ? [{ id: 'savings', name: 'Savings', color: ENTITY.savings }] : []),
    ...(hasTarget('surplus') ? [{ id: 'surplus', name: 'Surplus', color: ENTITY.surplus }] : []),
  ]
  const links: SankeyLinkDef[] = flow.links.map((l) => ({
    source: `member_${l.userId}`,
    target: targetId(l.target),
    value: parseFloat(l.amount),
  }))
  return { nodes, links }
}

/** Receipt consumption flow: total spent → category → subcategory. */
export function buildReceiptSankey(receiptSummary: ReceiptConsumptionSummary | undefined, receiptCustomRangeValid: boolean) {
  if (!receiptCustomRangeValid) return null
  if (!receiptSummary || parseFloat(receiptSummary.total) <= 0) return null
  const nodes: SankeyNodeDef[] = [
    { id: 'total_spent', name: 'Total spent', color: ENTITY.expenses },
    ...receiptSummary.byCategory.map((category, index) => ({
      id: categoryNodeId(category.categoryId),
      name: category.categoryName,
      color: seriesColor(index),
    })),
    ...receiptSummary.bySubcategory.map((subcategory, index) => ({
      id: subcategoryNodeId(subcategory.categoryId, subcategory.subcategoryId),
      name: subcategory.subcategoryName,
      color: seriesColor(index),
    })),
  ]
  const links: SankeyLinkDef[] = [
    ...receiptSummary.byCategory.map((category) => ({
      source: 'total_spent',
      target: categoryNodeId(category.categoryId),
      value: parseFloat(category.total),
    })),
    ...receiptSummary.bySubcategory.map((subcategory) => ({
      source: categoryNodeId(subcategory.categoryId),
      target: subcategoryNodeId(subcategory.categoryId, subcategory.subcategoryId),
      value: parseFloat(subcategory.total),
    })),
  ]
  return { nodes, links }
}

function categoryNodeId(categoryId: string | null) {
  return `receipt_cat_${categoryId ?? 'uncategorized'}`
}

function subcategoryNodeId(categoryId: string | null, subcategoryId: string | null) {
  return `receipt_sub_${categoryId ?? 'uncategorized'}_${subcategoryId ?? 'none'}`
}
