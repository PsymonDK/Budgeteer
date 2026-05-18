import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { AlertTriangle, Check, FileText, ScanLine, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { PageHeader } from '../components/PageHeader'
import { PageLoader } from '../components/LoadingSpinner'
import { inputClass, primaryBtn, secondaryBtn, dangerBtn } from '../lib/styles'
import { useBaseCurrency, useFmt } from '../hooks/useFmt'

type ReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'FAILED'
type ReceiptConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

interface Category {
  id: string
  name: string
  icon: string | null
}

interface ReceiptSubcategory {
  id: string
  categoryId: string
  householdId: string | null
  name: string
  isSystemWide: boolean
}

interface AccountInfo {
  id: string
  name: string
  type: string
}

interface ReceiptLineItem {
  id: string
  originalText: string
  label: string
  normalizedLabel: string
  quantity: string | null
  amount: string
  currencyCode: string | null
  confidence: ReceiptConfidence
  categoryId: string | null
  category: Category | null
  subcategoryId: string | null
  subcategory: ReceiptSubcategory | null
  isIgnored: boolean
}

interface Receipt {
  id: string
  merchantName: string | null
  purchaseDate: string | null
  totalAmount: string | null
  taxAmount: string | null
  feeAmount: string | null
  currencyCode: string
  status: ReceiptStatus
  confidence: ReceiptConfidence
  sourceFileName: string | null
  sourceMimeType: string | null
  rawText: string | null
  hasSourceFile: boolean
  notes: string[]
  accountId: string | null
  account: AccountInfo | null
  lineItems: ReceiptLineItem[]
  createdAt: string
}

interface ReceiptSummary {
  id: string
  merchantName: string | null
  purchaseDate: string | null
  totalAmount: string | null
  currencyCode: string
  status: ReceiptStatus
  confidence: ReceiptConfidence
  itemCount: number
  itemTotal: string
  lowConfidenceCount: number
}

interface ConsumptionSummary {
  total: string
  itemCount: number
  byCategory: Array<{ categoryId: string | null; categoryName: string; categoryIcon: string | null; total: string; itemCount: number }>
  bySubcategory: Array<{ categoryId: string | null; categoryName: string; subcategoryId: string | null; subcategoryName: string; total: string; itemCount: number }>
  byMonth: Array<{ month: string; total: string }>
}

interface LineDraft {
  label: string
  originalText: string
  quantity: string
  amount: string
  categoryId: string
  subcategoryId: string
  confidence: ReceiptConfidence
  isIgnored: boolean
}

const CONFIDENCE_CLASS: Record<ReceiptConfidence, string> = {
  HIGH: 'bg-green-900/40 text-green-300 border-green-800',
  MEDIUM: 'bg-amber-900/30 text-amber-300 border-amber-800',
  LOW: 'bg-red-900/30 text-red-300 border-red-800',
}

export function ReceiptsPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [accountId, setAccountId] = useState('')
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null)
  const [parseError, setParseError] = useState('')
  const [newSubcategoryName, setNewSubcategoryName] = useState<Record<string, string>>({})
  const [headerDraft, setHeaderDraft] = useState({
    merchantName: '',
    purchaseDate: '',
    totalAmount: '',
    taxAmount: '',
    feeAmount: '',
    currencyCode: baseCurrency,
    accountId: '',
  })
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({})

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<ReceiptSummary[]>({
    queryKey: ['receipts', householdId],
    queryFn: async () => (await api.get<ReceiptSummary[]>(`/households/${householdId}/receipts`)).data,
    enabled: !!householdId,
  })

  const { data: selectedReceipt, isLoading: receiptLoading } = useQuery<Receipt>({
    queryKey: ['receipt', householdId, selectedReceiptId],
    queryFn: async () => (await api.get<Receipt>(`/households/${householdId}/receipts/${selectedReceiptId}`)).data,
    enabled: !!householdId && !!selectedReceiptId,
  })

  const { data: summary } = useQuery<ConsumptionSummary>({
    queryKey: ['receipt-summary', householdId],
    queryFn: async () => (await api.get<ConsumptionSummary>(`/households/${householdId}/receipts/summary`)).data,
    enabled: !!householdId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', householdId, 'EXPENSE'],
    queryFn: async () => (await api.get<Category[]>(`/categories?householdId=${householdId}&type=EXPENSE`)).data,
    enabled: !!householdId,
  })

  const { data: subcategories = [] } = useQuery<ReceiptSubcategory[]>({
    queryKey: ['receipt-subcategories', householdId],
    queryFn: async () => (await api.get<ReceiptSubcategory[]>(`/households/${householdId}/receipt-subcategories`)).data,
    enabled: !!householdId,
  })

  const { data: personalAccounts = [] } = useQuery<AccountInfo[]>({
    queryKey: ['personal-accounts'],
    queryFn: async () => (await api.get<AccountInfo[]>('/users/me/accounts')).data,
  })

  const { data: householdAccounts = [] } = useQuery<AccountInfo[]>({
    queryKey: ['household-accounts', householdId],
    queryFn: async () => (await api.get<AccountInfo[]>(`/households/${householdId}/accounts`)).data,
    enabled: !!householdId,
  })
  const accountOptions = [...personalAccounts, ...householdAccounts]

  useEffect(() => {
    if (!selectedReceipt) return
    setHeaderDraft({
      merchantName: selectedReceipt.merchantName ?? '',
      purchaseDate: selectedReceipt.purchaseDate ?? '',
      totalAmount: selectedReceipt.totalAmount ?? '',
      taxAmount: selectedReceipt.taxAmount ?? '',
      feeAmount: selectedReceipt.feeAmount ?? '',
      currencyCode: selectedReceipt.currencyCode ?? baseCurrency,
      accountId: selectedReceipt.accountId ?? '',
    })
    setLineDrafts(Object.fromEntries(selectedReceipt.lineItems.map((item) => [item.id, lineToDraft(item)])))
  }, [selectedReceipt, baseCurrency])

  useEffect(() => {
    if (!selectedReceipt?.hasSourceFile || !householdId) {
      setReceiptPreviewUrl(null)
      return
    }

    let objectUrl: string | null = null
    api.get(`/households/${householdId}/receipts/${selectedReceipt.id}/file`, { responseType: 'blob' })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data)
        setReceiptPreviewUrl(objectUrl)
      })
      .catch(() => setReceiptPreviewUrl(null))

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedReceipt?.id, selectedReceipt?.hasSourceFile, householdId])

  const draftReceipts = receipts.filter((receipt) => receipt.status === 'DRAFT')
  const confirmedReceipts = receipts.filter((receipt) => receipt.status === 'CONFIRMED')

  const selectedItemsTotal = useMemo(() => {
    if (!selectedReceipt) return 0
    return selectedReceipt.lineItems
      .filter((item) => !lineDrafts[item.id]?.isIgnored)
      .reduce((sum, item) => sum + (parseFloat(lineDrafts[item.id]?.amount ?? item.amount) || 0), 0)
  }, [selectedReceipt, lineDrafts])

  const parseMutation = useMutation({
    mutationFn: async () => {
      if (receiptFile) {
        const form = new FormData()
        form.append('receipt', receiptFile)
        if (accountId) form.append('accountId', accountId)
        return (await api.post<Receipt>(`/households/${householdId}/receipts/upload`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })).data
      }
      const payload: Record<string, unknown> = {
        rawText: rawText.trim() || undefined,
        accountId: accountId || undefined,
      }
      return (await api.post<Receipt>(`/households/${householdId}/receipts/parse`, payload)).data
    },
    onSuccess: (receipt) => {
      setSelectedReceiptId(receipt.id)
      setRawText('')
      setFileName('')
      setReceiptFile(null)
      setParseError('')
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      toast.success('Receipt parsed for review')
    },
    onError: (err) => setParseError(readError(err, 'Failed to parse receipt')),
  })

  const saveHeaderMutation = useMutation({
    mutationFn: saveReceiptHeader,
    onSuccess: (receipt) => {
      queryClient.setQueryData(['receipt', householdId, receipt.id], receipt)
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      toast.success('Receipt details saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save receipt details')),
  })

  const saveLineMutation = useMutation({
    mutationFn: saveLineItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt', householdId, selectedReceiptId] })
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      toast.success('Line item saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save line item')),
  })

  const createSubcategoryMutation = useMutation({
    mutationFn: async ({ itemId, categoryId, name }: { itemId: string; categoryId: string; name: string }) => ({
      itemId,
      subcategory: (await api.post<ReceiptSubcategory>(`/categories/${categoryId}/subcategories`, { householdId, name })).data,
    }),
    onSuccess: ({ itemId, subcategory }) => {
      queryClient.invalidateQueries({ queryKey: ['receipt-subcategories', householdId] })
      updateLineDraft(itemId, { subcategoryId: subcategory.id })
      setNewSubcategoryName((prev) => ({ ...prev, [itemId]: '' }))
      toast.success('Subcategory added')
    },
    onError: (err) => toast.error(readError(err, 'Failed to add subcategory')),
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReceipt) throw new Error('No receipt selected')
      await saveReceiptHeader()
      await Promise.all(selectedReceipt.lineItems.map((item) => saveLineItem(item.id)))
      return (await api.post<Receipt>(`/households/${householdId}/receipts/${selectedReceiptId}/confirm`)).data
    },
    onSuccess: (receipt) => {
      queryClient.setQueryData(['receipt', householdId, receipt.id], receipt)
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
      toast.success('Receipt confirmed')
    },
    onError: (err) => toast.error(readError(err, 'Failed to confirm receipt')),
  })

  const deleteMutation = useMutation({
    mutationFn: (receiptId: string) => api.delete(`/households/${householdId}/receipts/${receiptId}`),
    onSuccess: (_res, receiptId) => {
      if (selectedReceiptId === receiptId) setSelectedReceiptId(null)
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
      toast.success('Receipt deleted')
    },
    onError: (err) => toast.error(readError(err, 'Failed to delete receipt')),
  })

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
      setParseError('Upload a PNG, JPEG, or PDF receipt')
      return
    }
    setFileName(file.name)
    setReceiptFile(file)
  }

  function handleParse(e: FormEvent) {
    e.preventDefault()
    setParseError('')
    if (!rawText.trim() && !receiptFile) {
      setParseError('Upload a receipt or paste OCR text first')
      return
    }
    parseMutation.mutate()
  }

  function updateLineDraft(itemId: string, patch: Partial<LineDraft>) {
    setLineDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function receiptHeaderPayload() {
    return {
      merchantName: headerDraft.merchantName || null,
      purchaseDate: headerDraft.purchaseDate || null,
      totalAmount: headerDraft.totalAmount ? parseFloat(headerDraft.totalAmount) : null,
      taxAmount: headerDraft.taxAmount ? parseFloat(headerDraft.taxAmount) : null,
      feeAmount: headerDraft.feeAmount ? parseFloat(headerDraft.feeAmount) : null,
      currencyCode: headerDraft.currencyCode || baseCurrency,
      accountId: headerDraft.accountId || null,
    }
  }

  async function saveReceiptHeader() {
    return (await api.put<Receipt>(`/households/${householdId}/receipts/${selectedReceiptId}`, receiptHeaderPayload())).data
  }

  async function saveLineItem(itemId: string) {
    const draft = lineDrafts[itemId]
    return (await api.put<ReceiptLineItem>(`/households/${householdId}/receipts/${selectedReceiptId}/line-items/${itemId}`, {
      label: draft.label,
      originalText: draft.originalText,
      quantity: draft.quantity ? parseFloat(draft.quantity) : null,
      amount: parseFloat(draft.amount) || 0,
      categoryId: draft.categoryId || null,
      subcategoryId: draft.subcategoryId || null,
      confidence: draft.confidence,
      isIgnored: draft.isIgnored,
    })).data
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <PageHeader title="Receipts" />

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <aside className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <ScanLine size={18} className="text-amber-400" />
              <h2 className="font-semibold">Import receipt</h2>
            </div>
            <form onSubmit={handleParse} className="space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-gray-400 mb-2">Image or scanned PDF</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  id="receipt-upload"
                />
                <label htmlFor="receipt-upload" className="flex items-center justify-center gap-2 border border-dashed border-gray-700 rounded-lg px-4 py-5 text-sm text-gray-400 hover:text-white hover:border-amber-400/60 transition-colors cursor-pointer">
                  <Upload size={16} />
                  {fileName || 'Choose receipt'}
                </label>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-gray-400 mb-2">OCR text</span>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className={`${inputClass} min-h-[160px] resize-y`}
                  placeholder="Paste receipt text when local image OCR is not configured"
                />
              </label>

              {accountOptions.length > 0 && (
                <label className="block">
                  <span className="block text-xs font-medium text-gray-400 mb-2">Account</span>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                    <option value="">No account</option>
                    {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
              )}

              {parseError && <p className="text-sm text-red-400">{parseError}</p>}
              <button type="submit" disabled={parseMutation.isPending} className={`${primaryBtn} w-full flex items-center justify-center gap-2`}>
                <ScanLine size={16} />
                {parseMutation.isPending ? 'Parsing…' : 'Parse receipt'}
              </button>
            </form>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="font-semibold mb-4">Consumption</h2>
            <div className="text-3xl font-semibold text-white mb-1">{fmt(summary?.total ?? '0')}</div>
            <p className="text-sm text-gray-500 mb-4">{summary?.itemCount ?? 0} confirmed line items</p>
            <div className="space-y-2">
              {(summary?.bySubcategory ?? []).slice(0, 6).map((row) => (
                <div key={row.subcategoryId ?? `${row.categoryId}-uncategorized`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-gray-300 min-w-0">
                    <span className="truncate">{row.categoryName} · {row.subcategoryName}</span>
                  </span>
                  <span className="text-gray-400 tabular-nums">{fmt(row.total)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold">Receipt history</h2>
            </div>
            {receiptsLoading ? (
              <PageLoader />
            ) : receipts.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">No receipts imported yet.</p>
            ) : (
              <div className="divide-y divide-gray-800 max-h-[560px] overflow-y-auto">
                {[...draftReceipts, ...confirmedReceipts].map((receipt) => (
                  <button
                    key={receipt.id}
                    onClick={() => setSelectedReceiptId(receipt.id)}
                    className={`w-full text-left px-5 py-4 hover:bg-gray-800/60 transition-colors ${selectedReceiptId === receipt.id ? 'bg-gray-800' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{receipt.merchantName || 'Unknown merchant'}</p>
                        <p className="text-xs text-gray-500">{receipt.purchaseDate ?? 'No date'} · {receipt.itemCount} items</p>
                      </div>
                      <span className={`text-[10px] border rounded-full px-2 py-0.5 ${receipt.status === 'CONFIRMED' ? 'border-green-800 text-green-300' : 'border-amber-800 text-amber-300'}`}>
                        {receipt.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{fmt(receipt.itemTotal)}</span>
                      {receipt.lowConfidenceCount > 0 && <span className="text-amber-300">{receipt.lowConfidenceCount} to review</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="bg-gray-900 border border-gray-800 rounded-xl min-h-[720px]">
          {!selectedReceiptId ? (
            <div className="h-full min-h-[520px] flex flex-col items-center justify-center text-center text-gray-500 px-6">
              <FileText size={36} className="mb-4 text-gray-700" />
              <p>Select a receipt or parse a new one.</p>
            </div>
          ) : receiptLoading || !selectedReceipt ? (
            <PageLoader />
          ) : (
            <div className="p-6 space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-semibold">{selectedReceipt.merchantName || 'Receipt review'}</h2>
                    <ConfidenceBadge confidence={selectedReceipt.confidence} />
                    {selectedReceipt.status === 'CONFIRMED' && <span className="text-xs border border-green-800 text-green-300 rounded-full px-2 py-1">Confirmed</span>}
                  </div>
                  <p className="text-sm text-gray-500">
                    {selectedReceipt.purchaseDate ?? 'No date'} · Items total {fmt(selectedItemsTotal.toFixed(2))}
                    {selectedReceipt.totalAmount ? ` · Receipt total ${fmt(selectedReceipt.totalAmount)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {selectedReceipt.status !== 'CONFIRMED' && (
                    <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} className={`${primaryBtn} flex items-center gap-2`}>
                      <Check size={16} />
                      Confirm
                    </button>
                  )}
                  <button onClick={() => deleteMutation.mutate(selectedReceipt.id)} className={`${dangerBtn} flex items-center gap-2`}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>

              {selectedReceipt.notes?.length > 0 && (
                <div className="border border-amber-800/60 bg-amber-900/20 rounded-lg p-4 text-sm text-amber-200">
                  <div className="flex items-center gap-2 font-medium mb-2"><AlertTriangle size={16} /> Parser notes</div>
                  <ul className="list-disc list-inside space-y-1">
                    {selectedReceipt.notes.map((note, index) => <li key={index}>{note}</li>)}
                  </ul>
                </div>
              )}

              <form
                onSubmit={(e) => { e.preventDefault(); saveHeaderMutation.mutate() }}
                className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-gray-800 rounded-xl p-4"
              >
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Merchant</span>
                  <input value={headerDraft.merchantName} onChange={(e) => setHeaderDraft({ ...headerDraft, merchantName: e.target.value })} className={inputClass} />
                </label>
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Purchase date</span>
                  <input type="date" value={headerDraft.purchaseDate} onChange={(e) => setHeaderDraft({ ...headerDraft, purchaseDate: e.target.value })} className={inputClass} />
                </label>
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Currency</span>
                  <input value={headerDraft.currencyCode} onChange={(e) => setHeaderDraft({ ...headerDraft, currencyCode: e.target.value.toUpperCase() })} className={inputClass} maxLength={3} />
                </label>
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Receipt total</span>
                  <input type="number" step="0.01" value={headerDraft.totalAmount} onChange={(e) => setHeaderDraft({ ...headerDraft, totalAmount: e.target.value })} className={inputClass} />
                </label>
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Tax</span>
                  <input type="number" step="0.01" value={headerDraft.taxAmount} onChange={(e) => setHeaderDraft({ ...headerDraft, taxAmount: e.target.value })} className={inputClass} />
                </label>
                <label>
                  <span className="block text-xs font-medium text-gray-400 mb-2">Fees</span>
                  <input type="number" step="0.01" value={headerDraft.feeAmount} onChange={(e) => setHeaderDraft({ ...headerDraft, feeAmount: e.target.value })} className={inputClass} />
                </label>
                {accountOptions.length > 0 && (
                  <label>
                    <span className="block text-xs font-medium text-gray-400 mb-2">Account</span>
                    <select value={headerDraft.accountId} onChange={(e) => setHeaderDraft({ ...headerDraft, accountId: e.target.value })} className={inputClass}>
                      <option value="">No account</option>
                      {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="md:col-span-3 flex justify-end">
                  <button type="submit" disabled={saveHeaderMutation.isPending} className={secondaryBtn}>Save receipt details</button>
                </div>
              </form>

              <div className="grid grid-cols-1 2xl:grid-cols-[420px_1fr] gap-4 items-start">
                <ReceiptPreview receipt={selectedReceipt} previewUrl={receiptPreviewUrl} />

                <div className="overflow-x-auto border border-gray-800 rounded-xl">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-left">
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium w-28">Qty</th>
                        <th className="px-4 py-3 font-medium w-32">Amount</th>
                        <th className="px-4 py-3 font-medium w-48">Category</th>
                        <th className="px-4 py-3 font-medium w-64">Subcategory</th>
                        <th className="px-4 py-3 font-medium w-28">Confidence</th>
                        <th className="px-4 py-3 font-medium w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {selectedReceipt.lineItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-gray-500">No line items detected. Paste OCR text and parse again, or configure local image OCR.</td>
                        </tr>
                      ) : selectedReceipt.lineItems.map((item) => {
                        const draft = lineDrafts[item.id] ?? lineToDraft(item)
                        const needsReview = draft.confidence === 'LOW' || !draft.categoryId
                        return (
                          <tr key={item.id} className={draft.isIgnored ? 'opacity-50' : ''}>
                            <td className="px-4 py-3">
                              <input value={draft.label} onChange={(e) => updateLineDraft(item.id, { label: e.target.value })} className={inputClass} />
                              {needsReview && <p className="mt-1 text-xs text-amber-300">Needs review</p>}
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" step="0.001" value={draft.quantity} onChange={(e) => updateLineDraft(item.id, { quantity: e.target.value })} className={inputClass} />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" step="0.01" value={draft.amount} onChange={(e) => updateLineDraft(item.id, { amount: e.target.value })} className={inputClass} />
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.categoryId}
                                onChange={(e) => updateLineDraft(item.id, { categoryId: e.target.value, subcategoryId: '' })}
                                className={inputClass}
                              >
                                <option value="">Uncategorized</option>
                                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.subcategoryId}
                                onChange={(e) => updateLineDraft(item.id, { subcategoryId: e.target.value })}
                                className={inputClass}
                                disabled={!draft.categoryId}
                              >
                                <option value="">No subcategory</option>
                                {subcategories
                                  .filter((subcategory) => subcategory.categoryId === draft.categoryId)
                                  .map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                              </select>
                              {draft.categoryId && (
                                <div className="mt-2 flex gap-2">
                                  <input
                                    value={newSubcategoryName[item.id] ?? ''}
                                    onChange={(e) => setNewSubcategoryName((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="New subcategory"
                                    className={`${inputClass} py-1.5`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const name = (newSubcategoryName[item.id] ?? '').trim()
                                      if (!name) return
                                      createSubcategoryMutation.mutate({ itemId: item.id, categoryId: draft.categoryId, name })
                                    }}
                                    className="text-xs bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-gray-300 whitespace-nowrap"
                                  >
                                    Add
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <select value={draft.confidence} onChange={(e) => updateLineDraft(item.id, { confidence: e.target.value as ReceiptConfidence })} className={inputClass}>
                                <option value="HIGH">High</option>
                                <option value="MEDIUM">Medium</option>
                                <option value="LOW">Low</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <button onClick={() => saveLineMutation.mutate(item.id)} className="text-xs bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-gray-300" type="button">Save</button>
                                <button
                                  onClick={() => updateLineDraft(item.id, { isIgnored: !draft.isIgnored })}
                                  className="text-xs bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-gray-300"
                                  type="button"
                                >
                                  {draft.isIgnored ? 'Use' : 'Ignore'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function ConfidenceBadge({ confidence }: { confidence: ReceiptConfidence }) {
  return <span className={`text-xs border rounded-full px-2 py-1 ${CONFIDENCE_CLASS[confidence]}`}>{confidence.toLowerCase()}</span>
}

function ReceiptPreview({ receipt, previewUrl }: { receipt: Receipt; previewUrl: string | null }) {
  return (
    <aside className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950 2xl:sticky 2xl:top-4">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Receipt</p>
          <p className="text-xs text-gray-500 truncate">{receipt.sourceFileName ?? 'No stored file'}</p>
        </div>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:text-amber-300">
            Open
          </a>
        )}
      </div>
      <div className="h-[620px] bg-gray-950 flex items-center justify-center">
        {!receipt.hasSourceFile ? (
          <div className="p-6 text-sm text-gray-500 text-center whitespace-pre-wrap">
            {receipt.rawText || 'No original receipt file stored for this import.'}
          </div>
        ) : !previewUrl ? (
          <p className="text-sm text-gray-500">Loading receipt…</p>
        ) : receipt.sourceMimeType === 'application/pdf' ? (
          <object data={previewUrl} type="application/pdf" className="w-full h-full">
            <iframe src={previewUrl} className="w-full h-full" title="Receipt PDF" />
          </object>
        ) : (
          <img src={previewUrl} alt="Receipt" className="max-w-full max-h-full object-contain" />
        )}
      </div>
    </aside>
  )
}

function lineToDraft(item: ReceiptLineItem): LineDraft {
  return {
    label: item.label,
    originalText: item.originalText,
    quantity: item.quantity ?? '',
    amount: item.amount,
    categoryId: item.categoryId ?? '',
    subcategoryId: item.subcategoryId ?? '',
    confidence: item.confidence,
    isIgnored: item.isIgnored,
  }
}

function readError(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string })?.error ?? fallback
  }
  return fallback
}
