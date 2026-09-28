// Node/link builders for the dashboard Sankey diagrams. These only reshape the
// server's pre-aggregated totals for display.

import type { SankeyLinkDef, SankeyNodeDef } from '../../components/SankeyChart'
import type { DashboardSummary, ReceiptConsumptionSummary } from './types'

const MEMBER_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
const CATEGORY_COLORS = ['#6366f1', '#f97316', '#a78bfa', '#fb923c', '#34d399', '#f43f5e', '#22d3ee', '#fbbf24']

/** VIZ-001: income flow from each member to expense categories, savings and surplus. */
export function buildIncomeSankey(summary: DashboardSummary | undefined, income: number, savings: number, surplus: number) {
  if (!summary?.budgetYear || income <= 0) return null
  const activeMembers = summary.income.members.filter((m) => parseFloat(m.monthlyAllocated) > 0)
  if (activeMembers.length === 0) return null
  const nodes: SankeyNodeDef[] = [
    ...activeMembers.map((m, i) => ({ id: `member_${m.userId}`, name: m.name, color: MEMBER_COLORS[i % MEMBER_COLORS.length] })),
    ...summary.expenses.byCategory.map((c, i) => ({ id: `cat_${c.categoryId}`, name: c.categoryName, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
    ...(savings > 0 ? [{ id: 'savings', name: 'Savings', color: '#3b82f6' }] : []),
    ...(surplus > 0 ? [{ id: 'surplus', name: 'Surplus', color: '#10b981' }] : []),
  ]
  const links: SankeyLinkDef[] = []
  for (const m of activeMembers) {
    const netShare = income > 0 ? parseFloat(m.monthlyAllocatedNet) / income : 0
    for (const c of summary.expenses.byCategory) {
      const val = parseFloat(c.totalMonthly) * netShare
      if (val > 0) links.push({ source: `member_${m.userId}`, target: `cat_${c.categoryId}`, value: val })
    }
    if (savings > 0) links.push({ source: `member_${m.userId}`, target: 'savings', value: savings * netShare })
    if (surplus > 0) links.push({ source: `member_${m.userId}`, target: 'surplus', value: surplus * netShare })
  }
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
