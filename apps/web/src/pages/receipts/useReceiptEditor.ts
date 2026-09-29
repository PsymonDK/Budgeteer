import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useBaseCurrency } from '../../hooks/useFmt'
import { EMPTY_MANUAL_LINE, headerPayload, linePayload, lineToDraft, readError, receiptToHeaderDraft } from './helpers'
import type { LineDraft, Receipt, ReceiptLineItem, ReceiptSubcategory } from './types'

function lineDraftsFor(receipt: Receipt): Record<string, LineDraft> {
  return Object.fromEntries(receipt.lineItems.map((item) => [item.id, lineToDraft(item)]))
}

/**
 * Edit state (header, line items, manual line, new-subcategory names) and the
 * save/confirm/delete mutations of the receipt review screen. Drafts are reset
 * from the server copy whenever the receipt query data changes.
 */
export function useReceiptEditor(householdId: string, receipt: Receipt, onDeleted: (receiptId: string) => void) {
  const queryClient = useQueryClient()
  const baseCurrency = useBaseCurrency()
  const receiptId = receipt.id

  const [headerDraft, setHeaderDraft] = useState(() => receiptToHeaderDraft(receipt, baseCurrency))
  const [lineDrafts, setLineDrafts] = useState(() => lineDraftsFor(receipt))
  const [manualLineDraft, setManualLineDraft] = useState<LineDraft>(EMPTY_MANUAL_LINE)
  const [newSubcategoryName, setNewSubcategoryName] = useState<Record<string, string>>({})

  useEffect(() => {
    setHeaderDraft(receiptToHeaderDraft(receipt, baseCurrency))
    setLineDrafts(lineDraftsFor(receipt))
  }, [receipt, baseCurrency])

  function updateHeaderDraft(patch: Partial<typeof headerDraft>) {
    setHeaderDraft((prev) => ({ ...prev, ...patch }))
  }

  function updateLineDraft(itemId: string, patch: Partial<LineDraft>) {
    setLineDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function invalidateLists() {
    queryClient.invalidateQueries({ queryKey: qk.receipts(householdId) })
    queryClient.invalidateQueries({ queryKey: qk.receiptSummaryAll(householdId) })
  }

  async function saveReceiptHeader() {
    return (await api.put<Receipt>(`/households/${householdId}/receipts/${receiptId}`, headerPayload(headerDraft, baseCurrency))).data
  }

  async function saveLineItem(itemId: string) {
    return (await api.put<ReceiptLineItem>(
      `/households/${householdId}/receipts/${receiptId}/line-items/${itemId}`,
      linePayload(lineDrafts[itemId]),
    )).data
  }

  async function createLineItem() {
    const label = manualLineDraft.label.trim()
    if (!label) throw new Error('Line item name is required')
    if (!manualLineDraft.amount.trim()) throw new Error('Line amount is required')
    return (await api.post<ReceiptLineItem>(`/households/${householdId}/receipts/${receiptId}/line-items`, {
      ...linePayload(manualLineDraft),
      label,
      originalText: manualLineDraft.originalText.trim() || label,
    })).data
  }

  const saveHeaderMutation = useMutation({
    mutationFn: saveReceiptHeader,
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.receipt(householdId, updated.id), updated)
      invalidateLists()
      toast.success('Receipt details saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save receipt details')),
  })

  const saveLineMutation = useMutation({
    mutationFn: saveLineItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.receipt(householdId, receiptId) })
      invalidateLists()
      toast.success('Line item saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save line item')),
  })

  const createLineMutation = useMutation({
    mutationFn: createLineItem,
    onSuccess: () => {
      setManualLineDraft(EMPTY_MANUAL_LINE)
      queryClient.invalidateQueries({ queryKey: qk.receipt(householdId, receiptId) })
      invalidateLists()
      toast.success('Line item added')
    },
    onError: (err) => toast.error(readError(err, 'Failed to add line item')),
  })

  const createSubcategoryMutation = useMutation({
    mutationFn: async ({ itemId, categoryId, name }: { itemId: string; categoryId: string; name: string }) => ({
      itemId,
      subcategory: (await api.post<ReceiptSubcategory>(`/categories/${categoryId}/subcategories`, { householdId, name })).data,
    }),
    onSuccess: ({ itemId, subcategory }) => {
      queryClient.invalidateQueries({ queryKey: qk.receiptSubcategories(householdId) })
      updateLineDraft(itemId, { subcategoryId: subcategory.id })
      setNewSubcategoryName((prev) => ({ ...prev, [itemId]: '' }))
      toast.success('Subcategory added')
    },
    onError: (err) => toast.error(readError(err, 'Failed to add subcategory')),
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await saveReceiptHeader()
      for (const item of receipt.lineItems) {
        await saveLineItem(item.id)
      }
      return (await api.post<Receipt>(`/households/${householdId}/receipts/${receiptId}/confirm`)).data
    },
    onSuccess: (confirmed) => {
      queryClient.setQueryData(qk.receipt(householdId, confirmed.id), confirmed)
      invalidateLists()
      toast.success('Receipt confirmed')
    },
    onError: (err) => toast.error(readError(err, 'Failed to confirm receipt')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/households/${householdId}/receipts/${id}`),
    onSuccess: (_res, id) => {
      onDeleted(id)
      invalidateLists()
      toast.success('Receipt deleted')
    },
    onError: (err) => toast.error(readError(err, 'Failed to delete receipt')),
  })

  function addSubcategory(itemId: string, categoryId: string) {
    const name = (newSubcategoryName[itemId] ?? '').trim()
    if (!name) return
    createSubcategoryMutation.mutate({ itemId, categoryId, name })
  }

  return {
    headerDraft, updateHeaderDraft,
    lineDrafts, updateLineDraft,
    manualLineDraft, setManualLineDraft,
    newSubcategoryName, setNewSubcategoryName, addSubcategory,
    saveHeaderMutation, saveLineMutation, createLineMutation, confirmMutation, deleteMutation,
  }
}
