// Receipt-only server state. Shared reads (accounts, categories, currencies,
// consumption summary) come from api/queries.ts.

import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { Receipt, ReceiptMappingExportKit, ReceiptSubcategory, ReceiptSummary } from './types'

/** GET /households/:id/receipts — newest purchase first. */
export function useReceipts(householdId: string) {
  return useQuery({
    queryKey: qk.receipts(householdId),
    queryFn: async () => (await api.get<ReceiptSummary[]>(`/households/${householdId}/receipts`)).data,
    enabled: !!householdId,
  })
}

/** GET /households/:id/receipts/:receiptId */
export function useReceipt(householdId: string, receiptId: string | null) {
  return useQuery({
    queryKey: qk.receipt(householdId, receiptId),
    queryFn: async () => (await api.get<Receipt>(`/households/${householdId}/receipts/${receiptId}`)).data,
    enabled: !!householdId && !!receiptId,
  })
}

/** GET /households/:id/receipt-subcategories — active system-wide and household subcategories. */
export function useReceiptSubcategories(householdId: string) {
  return useQuery({
    queryKey: qk.receiptSubcategories(householdId),
    queryFn: async () => (await api.get<ReceiptSubcategory[]>(`/households/${householdId}/receipt-subcategories`)).data,
    enabled: !!householdId,
  })
}

/** GET /households/:id/receipt-mappings/export-kit */
export function useReceiptMappingExportKit(householdId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.receiptMappingExportKit(householdId),
    queryFn: async () => (await api.get<ReceiptMappingExportKit>(`/households/${householdId}/receipt-mappings/export-kit`)).data,
    enabled: !!householdId && enabled,
  })
}
