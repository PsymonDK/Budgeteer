// Node/link builders for the dashboard Sankey diagrams. These only reshape the
// server's pre-aggregated totals for display.

import type { SankeyLinkDef, SankeyNodeDef } from '../../components/SankeyChart'
import type { DashboardSummary, IncomeFlowTarget, ReceiptConsumptionSummary } from './types'

const MEMBER_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
const CATEGORY_COLORS = ['#6366f1', '#f97316', '#a78bfa', '#fb923c', '#34d399', '#f43f5e', '#22d3ee', '#fbbf24']

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
    ...flow.members.map((m, i) => ({ id: `member_${m.userId}`, name: m.name, color: MEMBER_COLORS[i % MEMBER_COLORS.length] })),
    ...categories.map(([id, name], i) => ({ id: `cat_${id}`, name, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
    ...(hasTarget('savings') ? [{ id: 'savings', name: 'Savings', color: '#3b82f6' }] : []),
    ...(hasTarget('surplus') ? [{ id: 'surplus', name: 'Surplus', color: '#10b981' }] : []),
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
    { id: 'total_spent', name: 'Total spent', color: '#f59e0b' },
    ...receiptSummary.byCategory.map((category, index) => ({
      id: categoryNodeId(category.categoryId),
      name: category.categoryName,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    })),
    ...receiptSummary.bySubcategory.map((subcategory, index) => ({
      id: subcategoryNodeId(subcategory.categoryId, subcategory.subcategoryId),
      name: subcategory.subcategoryName,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
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
