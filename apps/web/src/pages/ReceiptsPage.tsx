import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { AlertTriangle, ArrowLeft, Check, Clipboard, Download, FileText, FileUp, PanelLeftClose, PanelLeftOpen, Plus, ScanLine, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { PageHeader } from '../components/PageHeader'
import { PageLoader } from '../components/LoadingSpinner'
import { Modal } from '../components/Modal'
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

interface Currency {
  code: string
  name: string
  rate: number | null
  baseCurrency: string
  fetchedDate: string | null
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

interface ReceiptMappingExportKit {
  headers: string[]
  prompt: string
  templateCsv: string
  categoryCsv: string
  existingMappingsCsv: string
  classifierTermCsv: string
}

type ReceiptMappingImportStatus = 'create' | 'update' | 'unchanged' | 'invalid' | 'skipped'

interface ReceiptMappingImportRow {
  rowNumber: number
  merchantName: string
  merchantKey: string
  originalLabel: string
  normalizedLabel: string
  categoryId: string
  categoryName: string
  subcategoryId: string | null
  subcategoryName: string
  confidence: number
  termType: '' | 'NOISE_TOKEN' | 'LOW_VALUE_WORD'
  term: string
  isActive: boolean
  kind: 'mapping' | 'term'
  notes: string
  status: ReceiptMappingImportStatus
  errors: string[]
}

interface ReceiptMappingImportPreview {
  counts: Record<ReceiptMappingImportStatus, number> & { total: number; valid: number }
  rows: ReceiptMappingImportRow[]
}

type ReceiptSummaryPeriod = 'allTime' | 'currentMonth' | 'previousMonth' | 'currentQuarter' | 'previousQuarter' | 'currentYear' | 'previousYear' | 'last12Months' | 'custom'

interface ReceiptConsumptionSummary {
  total: string
  itemCount: number
  baseCurrency: string
  period: ReceiptSummaryPeriod | 'legacy'
  startDate: string | null
  endDate: string | null
  warnings: string[]
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

const EMPTY_MANUAL_LINE: LineDraft = {
  label: '',
  originalText: '',
  quantity: '',
  amount: '',
  categoryId: '',
  subcategoryId: '',
  confidence: 'HIGH',
  isIgnored: false,
}

const CONFIDENCE_CLASS: Record<ReceiptConfidence, string> = {
  HIGH: 'bg-green-900/40 text-green-300 border-green-800',
  MEDIUM: 'bg-amber-900/30 text-amber-300 border-amber-800',
  LOW: 'bg-red-900/30 text-red-300 border-red-800',
}

const MAPPING_STATUS_CLASS: Record<ReceiptMappingImportStatus, string> = {
  create: 'border-green-800 text-green-300 bg-green-900/30',
  update: 'border-blue-800 text-blue-300 bg-blue-900/30',
  unchanged: 'border-gray-700 text-gray-300 bg-gray-800/60',
  invalid: 'border-red-800 text-red-300 bg-red-900/30',
  skipped: 'border-amber-800 text-amber-300 bg-amber-900/30',
}

const compactInputClass =
  'w-full min-w-0 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors'

const RECEIPT_PERIOD_OPTIONS: Array<{ value: ReceiptSummaryPeriod; label: string }> = [
  { value: 'allTime', label: 'All time' },
  { value: 'currentMonth', label: 'Current month' },
  { value: 'previousMonth', label: 'Previous month' },
  { value: 'currentQuarter', label: 'Current quarter' },
  { value: 'previousQuarter', label: 'Previous quarter' },
  { value: 'currentYear', label: 'Current year' },
  { value: 'previousYear', label: 'Previous year' },
  { value: 'last12Months', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom' },
]

const CATEGORY_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#a78bfa']

export function ReceiptsPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const fmt = useFmt()
  const baseCurrency = useBaseCurrency()
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null)
  const [newSubcategoryName, setNewSubcategoryName] = useState<Record<string, string>>({})
  const [showReviewOnly, setShowReviewOnly] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth >= 1280)
  const [showParserNotes, setShowParserNotes] = useState(false)
  const [mappingModalOpen, setMappingModalOpen] = useState(false)
  const [mappingTab, setMappingTab] = useState<'export' | 'import'>('export')
  const [mappingCsvText, setMappingCsvText] = useState('')
  const [receiptPeriod, setReceiptPeriod] = useState<ReceiptSummaryPeriod>('currentMonth')
  const [receiptStartDate, setReceiptStartDate] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [receiptEndDate, setReceiptEndDate] = useState(() => new Date().toISOString().slice(0, 10))
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
  const [manualLineDraft, setManualLineDraft] = useState<LineDraft>(EMPTY_MANUAL_LINE)

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

  const receiptSummaryQuery = useMemo(() => {
    const params = new URLSearchParams({ period: receiptPeriod })
    if (receiptPeriod === 'custom') {
      params.set('startDate', receiptStartDate)
      params.set('endDate', receiptEndDate)
    }
    return params.toString()
  }, [receiptEndDate, receiptPeriod, receiptStartDate])
  const receiptCustomRangeValid = receiptPeriod !== 'custom' || Boolean(receiptStartDate && receiptEndDate && receiptStartDate <= receiptEndDate)

  const { data: receiptConsumption, isLoading: receiptConsumptionLoading, isFetching: receiptConsumptionFetching } = useQuery<ReceiptConsumptionSummary>({
    queryKey: ['receipt-summary', householdId, receiptPeriod, receiptStartDate, receiptEndDate],
    queryFn: async () => (await api.get<ReceiptConsumptionSummary>(`/households/${householdId}/receipts/summary?${receiptSummaryQuery}`)).data,
    enabled: !!householdId && receiptCustomRangeValid,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<Currency[]>('/currencies')).data,
  })

  const { data: mappingExportKit, isLoading: mappingExportLoading } = useQuery<ReceiptMappingExportKit>({
    queryKey: ['receipt-mapping-export-kit', householdId],
    queryFn: async () => (await api.get<ReceiptMappingExportKit>(`/households/${householdId}/receipt-mappings/export-kit`)).data,
    enabled: !!householdId && mappingModalOpen,
  })

  const currencyOptions = useMemo(() => {
    const fallbackCurrency = baseCurrency || 'DKK'
    const options = new Map<string, { code: string; name: string }>()
    options.set(fallbackCurrency, { code: fallbackCurrency, name: 'Base currency' })
    for (const currency of currencies) {
      options.set(currency.code, { code: currency.code, name: currency.name })
    }
    if (headerDraft.currencyCode && !options.has(headerDraft.currencyCode)) {
      options.set(headerDraft.currencyCode, { code: headerDraft.currencyCode, name: 'Current receipt currency' })
    }
    return [...options.values()].sort((a, b) => {
      if (a.code === fallbackCurrency) return -1
      if (b.code === fallbackCurrency) return 1
      return a.code.localeCompare(b.code)
    })
  }, [baseCurrency, currencies, headerDraft.currencyCode])

  useEffect(() => {
    const receiptId = searchParams.get('receiptId')
    if (receiptId) setSelectedReceiptId(receiptId)
  }, [searchParams])

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
  const allReceipts = [...draftReceipts, ...confirmedReceipts]

  const selectedItemsTotal = useMemo(() => {
    if (!selectedReceipt) return 0
    return selectedReceipt.lineItems
      .filter((item) => !lineDrafts[item.id]?.isIgnored)
      .reduce((sum, item) => sum + (parseFloat(lineDrafts[item.id]?.amount ?? item.amount) || 0), 0)
  }, [selectedReceipt, lineDrafts])

  const reviewLineCount = useMemo(() => {
    if (!selectedReceipt) return 0
    return selectedReceipt.lineItems.filter((item) => draftNeedsReview(lineDrafts[item.id] ?? lineToDraft(item))).length
  }, [selectedReceipt, lineDrafts])

  const visibleLineItems = useMemo(() => {
    if (!selectedReceipt) return []
    if (!showReviewOnly) return selectedReceipt.lineItems
    return selectedReceipt.lineItems.filter((item) => draftNeedsReview(lineDrafts[item.id] ?? lineToDraft(item)))
  }, [selectedReceipt, lineDrafts, showReviewOnly])

  const saveHeaderMutation = useMutation({
    mutationFn: saveReceiptHeader,
    onSuccess: (receipt) => {
      queryClient.setQueryData(['receipt', householdId, receipt.id], receipt)
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
      toast.success('Receipt details saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save receipt details')),
  })

  const saveLineMutation = useMutation({
    mutationFn: saveLineItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt', householdId, selectedReceiptId] })
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
      toast.success('Line item saved')
    },
    onError: (err) => toast.error(readError(err, 'Failed to save line item')),
  })

  const createLineMutation = useMutation({
    mutationFn: createLineItem,
    onSuccess: () => {
      setManualLineDraft(EMPTY_MANUAL_LINE)
      queryClient.invalidateQueries({ queryKey: ['receipt', householdId, selectedReceiptId] })
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
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
      for (const item of selectedReceipt.lineItems) {
        await saveLineItem(item.id)
      }
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
      if (selectedReceiptId === receiptId) {
        setSelectedReceiptId(null)
        setSearchParams({})
      }
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipt-summary', householdId] })
      toast.success('Receipt deleted')
    },
    onError: (err) => toast.error(readError(err, 'Failed to delete receipt')),
  })

  const previewMappingImportMutation = useMutation({
    mutationFn: async () => (await api.post<ReceiptMappingImportPreview>(`/households/${householdId}/receipt-mappings/import-preview`, { csvText: mappingCsvText })).data,
    onError: (err) => toast.error(readError(err, 'Failed to preview mappings')),
  })

  const confirmMappingImportMutation = useMutation({
    mutationFn: async () => (await api.post<ReceiptMappingImportPreview>(`/households/${householdId}/receipt-mappings/import-confirm`, { csvText: mappingCsvText })).data,
    onSuccess: (preview) => {
      queryClient.invalidateQueries({ queryKey: ['receipt-mapping-export-kit', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      previewMappingImportMutation.reset()
      setMappingCsvText('')
      toast.success(`${preview.counts.create + preview.counts.update} mapping${preview.counts.create + preview.counts.update === 1 ? '' : 's'} saved`)
    },
    onError: (err) => toast.error(readError(err, 'Failed to import mappings')),
  })

  function updateLineDraft(itemId: string, patch: Partial<LineDraft>) {
    setLineDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function receiptHeaderPayload() {
    return {
      merchantName: headerDraft.merchantName || null,
      purchaseDate: headerDraft.purchaseDate || null,
      taxAmount: headerDraft.taxAmount ? parseFloat(headerDraft.taxAmount) : null,
      feeAmount: headerDraft.feeAmount ? parseFloat(headerDraft.feeAmount) : null,
      currencyCode: headerDraft.currencyCode || baseCurrency || 'DKK',
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

  async function createLineItem() {
    const label = manualLineDraft.label.trim()
    if (!label) throw new Error('Line item name is required')
    if (!manualLineDraft.amount.trim()) throw new Error('Line amount is required')
    return (await api.post<ReceiptLineItem>(`/households/${householdId}/receipts/${selectedReceiptId}/line-items`, {
      label,
      originalText: manualLineDraft.originalText.trim() || label,
      quantity: manualLineDraft.quantity ? parseFloat(manualLineDraft.quantity) : null,
      amount: parseFloat(manualLineDraft.amount) || 0,
      categoryId: manualLineDraft.categoryId || null,
      subcategoryId: manualLineDraft.subcategoryId || null,
      confidence: manualLineDraft.confidence,
      isIgnored: manualLineDraft.isIgnored,
    })).data
  }

  function openMappingModal(tab: 'export' | 'import') {
    setMappingTab(tab)
    setMappingModalOpen(true)
  }

  function handleMappingCsvChange(value: string) {
    setMappingCsvText(value)
    previewMappingImportMutation.reset()
    confirmMappingImportMutation.reset()
  }

  function handleMappingFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text()
      .then(handleMappingCsvChange)
      .catch(() => toast.error('Failed to read mapping CSV'))
  }

  function downloadMappingText(fileName: string, text: string, mime = 'text/csv') {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function copyMappingPrompt() {
    if (!mappingExportKit) return
    try {
      await navigator.clipboard.writeText(mappingExportKit.prompt)
      toast.success('Prompt copied')
    } catch {
      toast.error('Clipboard copy failed')
    }
  }

  return (
    <main className="w-full max-w-none px-3 sm:px-5 lg:px-6 py-5 overflow-x-hidden">
      <PageHeader
        title="Receipts"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => openMappingModal('export')} className={`${secondaryBtn} flex items-center gap-2`}>
              <Download size={16} />
              Export LLM kit
            </button>
            <button type="button" onClick={() => openMappingModal('import')} className={`${secondaryBtn} flex items-center gap-2`}>
              <FileUp size={16} />
              Import mappings
            </button>
            <Link to={`/households/${householdId}/receipts/new`} className={`${primaryBtn} flex items-center gap-2`}>
              <Plus size={16} />
              Add receipt
            </Link>
          </div>
        )}
      />

      <div className="mb-4">
        <ReceiptConsumptionPanel
          summary={receiptConsumption}
          isLoading={receiptConsumptionLoading}
          isFetching={receiptConsumptionFetching}
          period={receiptPeriod}
          startDate={receiptStartDate}
          endDate={receiptEndDate}
          customRangeValid={receiptCustomRangeValid}
          onPeriodChange={setReceiptPeriod}
          onStartDateChange={setReceiptStartDate}
          onEndDateChange={setReceiptEndDate}
          fmt={fmt}
        />
      </div>

      <div className={`grid gap-4 min-w-0 ${isHistoryOpen ? 'xl:grid-cols-[300px_minmax(0,1fr)]' : 'xl:grid-cols-[56px_minmax(0,1fr)]'}`}>
        <aside className="min-w-0">
          <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden xl:sticky xl:top-5">
            <div className={`border-b border-gray-800 flex items-center gap-2 ${isHistoryOpen ? 'px-3 py-3 justify-between' : 'p-2 justify-center'}`}>
              {isHistoryOpen && <h2 className="font-semibold text-sm">Receipt history</h2>}
              <button
                type="button"
                onClick={() => setIsHistoryOpen((open) => !open)}
                className="h-9 w-9 shrink-0 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 inline-flex items-center justify-center"
                aria-label={isHistoryOpen ? 'Collapse receipt history' : 'Expand receipt history'}
              >
                {isHistoryOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
            </div>

            {receiptsLoading ? (
              <div className="min-h-24"><PageLoader /></div>
            ) : receipts.length === 0 ? (
              <p className={`${isHistoryOpen ? 'p-4' : 'sr-only'} text-sm text-gray-500`}>No receipts imported yet.</p>
            ) : (
              <div className="divide-y divide-gray-800 max-h-[calc(100vh-190px)] overflow-y-auto">
                {allReceipts.map((receipt) => {
                  const isSelected = selectedReceiptId === receipt.id
                  return (
                    <button
                      key={receipt.id}
                      onClick={() => {
                        setSelectedReceiptId(receipt.id)
                        setSearchParams({ receiptId: receipt.id })
                      }}
                      className={`w-full text-left hover:bg-gray-800/60 transition-colors ${isSelected ? 'bg-gray-800' : ''} ${isHistoryOpen ? 'px-3 py-3' : 'p-2'}`}
                      title={receipt.merchantName || 'Unknown merchant'}
                    >
                      {isHistoryOpen ? (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{receipt.merchantName || 'Unknown merchant'}</p>
                              <p className="text-xs text-gray-500">{receipt.purchaseDate ?? 'No date'} · {receipt.itemCount} items</p>
                            </div>
                            <span className={`text-[10px] border rounded-full px-2 py-0.5 shrink-0 ${receipt.status === 'CONFIRMED' ? 'border-green-800 text-green-300' : 'border-amber-800 text-amber-300'}`}>
                              {receipt.status}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                            <span>{fmt(receipt.itemTotal)}</span>
                            {receipt.lowConfidenceCount > 0 && <span className="text-amber-300">{receipt.lowConfidenceCount} to review</span>}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <span className={`h-3 w-3 rounded-full ${receipt.status === 'CONFIRMED' ? 'bg-green-400' : 'bg-amber-400'}`} />
                          {receipt.lowConfidenceCount > 0 && <span className="text-[10px] text-amber-300">{receipt.lowConfidenceCount}</span>}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </aside>

        <section className="min-w-0 bg-gray-900 border border-gray-800 rounded-xl min-h-[calc(100vh-150px)] overflow-hidden">
          {!selectedReceiptId ? (
            <div className="h-full min-h-[520px] flex flex-col items-center justify-center text-center text-gray-500 px-6">
              <FileText size={36} className="mb-4 text-gray-700" />
              <p>Select a receipt or add a new one.</p>
            </div>
          ) : receiptLoading || !selectedReceipt ? (
            <PageLoader />
          ) : (
            <div className="min-w-0">
              <div className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900/95 backdrop-blur px-4 py-3">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold truncate">{selectedReceipt.merchantName || 'Receipt review'}</h2>
                      <ConfidenceBadge confidence={selectedReceipt.confidence} />
                      <span className={`text-xs border rounded-full px-2 py-1 ${selectedReceipt.status === 'CONFIRMED' ? 'border-green-800 text-green-300' : 'border-amber-800 text-amber-300'}`}>
                        {selectedReceipt.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {selectedReceipt.purchaseDate ?? 'No date'} · {selectedReceipt.lineItems.length} lines · Total {fmt(selectedItemsTotal.toFixed(2))}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveHeaderMutation.mutate()}
                      disabled={saveHeaderMutation.isPending}
                      className={secondaryBtn}
                    >
                      {saveHeaderMutation.isPending ? 'Saving...' : 'Save details'}
                    </button>
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
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-4 p-4 min-w-0">
                <ReceiptPreview receipt={selectedReceipt} previewUrl={receiptPreviewUrl} />

                <div className="min-w-0 space-y-4">
                  {selectedReceipt.notes?.length > 0 && (
                    <div className="border border-amber-800/60 bg-amber-900/20 rounded-lg text-sm text-amber-200">
                      <button
                        type="button"
                        onClick={() => setShowParserNotes((show) => !show)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <span className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> Parser notes</span>
                        <span className="text-xs text-amber-300">{showParserNotes ? 'Hide' : `${selectedReceipt.notes.length} notes`}</span>
                      </button>
                      {showParserNotes && (
                        <ul className="px-4 pb-3 list-disc list-inside space-y-1">
                          {selectedReceipt.notes.map((note, index) => <li key={index}>{note}</li>)}
                        </ul>
                      )}
                    </div>
                  )}

                  <form
                    onSubmit={(e) => { e.preventDefault(); saveHeaderMutation.mutate() }}
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 border border-gray-800 rounded-xl p-3"
                  >
                    <label className="min-w-0 xl:col-span-2">
                      <span className="block text-xs font-medium text-gray-400 mb-1.5">Merchant</span>
                      <input value={headerDraft.merchantName} onChange={(e) => setHeaderDraft({ ...headerDraft, merchantName: e.target.value })} className={compactInputClass} />
                    </label>
                    <label className="min-w-0">
                      <span className="block text-xs font-medium text-gray-400 mb-1.5">Purchase date</span>
                      <input type="date" value={headerDraft.purchaseDate} onChange={(e) => setHeaderDraft({ ...headerDraft, purchaseDate: e.target.value })} className={compactInputClass} />
                    </label>
                    <label className="min-w-0">
                      <span className="block text-xs font-medium text-gray-400 mb-1.5">Currency</span>
                      <select value={headerDraft.currencyCode || baseCurrency || 'DKK'} onChange={(e) => setHeaderDraft({ ...headerDraft, currencyCode: e.target.value })} className={compactInputClass}>
                        {currencyOptions.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code === (baseCurrency || 'DKK') ? `${currency.code} (base)` : `${currency.code} - ${currency.name}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="block text-xs font-medium text-gray-400 mb-1.5">Tax</span>
                      <input type="number" step="0.01" value={headerDraft.taxAmount} onChange={(e) => setHeaderDraft({ ...headerDraft, taxAmount: e.target.value })} className={compactInputClass} />
                    </label>
                    <label className="min-w-0">
                      <span className="block text-xs font-medium text-gray-400 mb-1.5">Fees</span>
                      <input type="number" step="0.01" value={headerDraft.feeAmount} onChange={(e) => setHeaderDraft({ ...headerDraft, feeAmount: e.target.value })} className={compactInputClass} />
                    </label>
                    {accountOptions.length > 0 && (
                      <label className="min-w-0 md:col-span-2">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Account</span>
                        <select value={headerDraft.accountId} onChange={(e) => setHeaderDraft({ ...headerDraft, accountId: e.target.value })} className={compactInputClass}>
                          <option value="">No account</option>
                          {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      </label>
                    )}
                  </form>

                  {selectedReceipt.status !== 'CONFIRMED' && (
                    <form
                      onSubmit={(e) => { e.preventDefault(); createLineMutation.mutate() }}
                      className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_auto] gap-2 border border-gray-800 rounded-xl p-3"
                    >
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Item</span>
                        <input
                          value={manualLineDraft.label}
                          onChange={(e) => setManualLineDraft((draft) => ({ ...draft, label: e.target.value, originalText: e.target.value }))}
                          className={compactInputClass}
                          placeholder="Manual line item"
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Qty</span>
                        <input
                          type="number"
                          step="0.001"
                          value={manualLineDraft.quantity}
                          onChange={(e) => setManualLineDraft((draft) => ({ ...draft, quantity: e.target.value }))}
                          className={compactInputClass}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Amount</span>
                        <input
                          type="number"
                          step="0.01"
                          value={manualLineDraft.amount}
                          onChange={(e) => setManualLineDraft((draft) => ({ ...draft, amount: e.target.value }))}
                          className={compactInputClass}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Category</span>
                        <select
                          value={manualLineDraft.categoryId}
                          onChange={(e) => setManualLineDraft((draft) => ({ ...draft, categoryId: e.target.value, subcategoryId: '' }))}
                          className={compactInputClass}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      </label>
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-1.5">Subcategory</span>
                        <select
                          value={manualLineDraft.subcategoryId}
                          onChange={(e) => setManualLineDraft((draft) => ({ ...draft, subcategoryId: e.target.value }))}
                          className={compactInputClass}
                          disabled={!manualLineDraft.categoryId}
                        >
                          <option value="">No subcategory</option>
                          {subcategories
                            .filter((subcategory) => subcategory.categoryId === manualLineDraft.categoryId)
                            .map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                        </select>
                      </label>
                      <div className="flex items-end md:col-span-2 2xl:col-span-1">
                        <button type="submit" disabled={createLineMutation.isPending} className={`${primaryBtn} w-full flex items-center justify-center gap-2`}>
                          <Plus size={16} />
                          Add line
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-400">
                      {reviewLineCount === 0 ? 'All detected lines have a category suggestion.' : `${reviewLineCount} ${reviewLineCount === 1 ? 'line needs' : 'lines need'} review.`}
                    </p>
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={showReviewOnly}
                        onChange={(e) => setShowReviewOnly(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-amber-400 focus:ring-amber-400"
                      />
                      Show only lines needing review
                    </label>
                  </div>

                  <div className="border border-gray-800 rounded-xl overflow-hidden">
                    <div className="hidden 2xl:grid grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_96px_104px] gap-2 px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400">
                      <span>Item</span>
                      <span>Qty</span>
                      <span>Amount</span>
                      <span>Category</span>
                      <span>Subcategory</span>
                      <span>Confidence</span>
                      <span>Actions</span>
                    </div>
                    <div className="divide-y divide-gray-800">
                      {selectedReceipt.lineItems.length === 0 ? (
                        <p className="px-4 py-10 text-center text-gray-500">No line items detected. Add receipt lines manually above.</p>
                      ) : visibleLineItems.length === 0 ? (
                        <p className="px-4 py-10 text-center text-gray-500">No lines need review.</p>
                      ) : visibleLineItems.map((item) => {
                        const draft = lineDrafts[item.id] ?? lineToDraft(item)
                        const needsReview = draftNeedsReview(draft)
                        return (
                          <div key={item.id} className={`grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-[minmax(150px,1.4fr)_72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_96px_104px] gap-2 p-3 ${draft.isIgnored ? 'opacity-50' : ''}`}>
                            <label className="min-w-0 md:col-span-2 2xl:col-span-1">
                              <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Item</span>
                              <input value={draft.label} onChange={(e) => updateLineDraft(item.id, { label: e.target.value })} className={compactInputClass} />
                              {needsReview && <p className="mt-1 text-xs text-amber-300">Needs review</p>}
                            </label>
                            <label className="min-w-0">
                              <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Qty</span>
                              <input type="number" step="0.001" value={draft.quantity} onChange={(e) => updateLineDraft(item.id, { quantity: e.target.value })} className={compactInputClass} />
                            </label>
                            <label className="min-w-0">
                              <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Amount</span>
                              <input type="number" step="0.01" value={draft.amount} onChange={(e) => updateLineDraft(item.id, { amount: e.target.value })} className={compactInputClass} />
                            </label>
                            <label className="min-w-0">
                              <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Category</span>
                              <select
                                value={draft.categoryId}
                                onChange={(e) => updateLineDraft(item.id, { categoryId: e.target.value, subcategoryId: '' })}
                                className={compactInputClass}
                              >
                                <option value="">Uncategorized</option>
                                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                              </select>
                            </label>
                            <div className="min-w-0">
                              <label>
                                <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Subcategory</span>
                                <select
                                  value={draft.subcategoryId}
                                  onChange={(e) => updateLineDraft(item.id, { subcategoryId: e.target.value })}
                                  className={compactInputClass}
                                  disabled={!draft.categoryId}
                                >
                                  <option value="">No subcategory</option>
                                  {subcategories
                                    .filter((subcategory) => subcategory.categoryId === draft.categoryId)
                                    .map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                                </select>
                              </label>
                              {draft.categoryId && (
                                <div className="mt-2 flex gap-2">
                                  <input
                                    value={newSubcategoryName[item.id] ?? ''}
                                    onChange={(e) => setNewSubcategoryName((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="New subcategory"
                                    className={`${compactInputClass} py-1.5`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const name = (newSubcategoryName[item.id] ?? '').trim()
                                      if (!name) return
                                      createSubcategoryMutation.mutate({ itemId: item.id, categoryId: draft.categoryId, name })
                                    }}
                                    className="text-xs bg-gray-800 hover:bg-gray-700 rounded-md px-3 py-2 text-gray-300 whitespace-nowrap"
                                  >
                                    Add
                                  </button>
                                </div>
                              )}
                            </div>
                            <label className="min-w-0">
                              <span className="2xl:hidden block text-xs font-medium text-gray-400 mb-1.5">Confidence</span>
                              <select value={draft.confidence} onChange={(e) => updateLineDraft(item.id, { confidence: e.target.value as ReceiptConfidence })} className={compactInputClass}>
                                <option value="HIGH">High</option>
                                <option value="MEDIUM">Medium</option>
                                <option value="LOW">Low</option>
                              </select>
                            </label>
                            <div className="flex items-end gap-2 md:col-span-2 2xl:col-span-1">
                              <button onClick={() => saveLineMutation.mutate(item.id)} className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 rounded-md px-3 py-2 text-gray-300" type="button">Save</button>
                              <button
                                onClick={() => updateLineDraft(item.id, { isIgnored: !draft.isIgnored })}
                                className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 rounded-md px-3 py-2 text-gray-300"
                                type="button"
                              >
                                {draft.isIgnored ? 'Use' : 'Ignore'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {mappingModalOpen && (
        <Modal title="Receipt mapping training" size="xl" onClose={() => setMappingModalOpen(false)}>
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
              <button
                type="button"
                onClick={() => setMappingTab('export')}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${mappingTab === 'export' ? 'bg-amber-400 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                Export LLM kit
              </button>
              <button
                type="button"
                onClick={() => setMappingTab('import')}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${mappingTab === 'import' ? 'bg-amber-400 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                Import mappings
              </button>
            </div>

            {mappingTab === 'export' ? (
              <div className="space-y-4">
                {mappingExportLoading ? (
                  <PageLoader />
                ) : !mappingExportKit ? (
                  <p className="text-sm text-gray-500">Mapping kit could not be loaded.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                      <button type="button" onClick={copyMappingPrompt} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                        <Clipboard size={16} />
                        Copy prompt
                      </button>
                      <button type="button" onClick={() => downloadMappingText('budgeteer-receipt-mapping-prompt.txt', mappingExportKit.prompt, 'text/plain')} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                        <Download size={16} />
                        Prompt
                      </button>
                      <button type="button" onClick={() => downloadMappingText('budgeteer-receipt-mapping-template.csv', mappingExportKit.templateCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                        <Download size={16} />
                        Template CSV
                      </button>
                      <button type="button" onClick={() => downloadMappingText('budgeteer-receipt-category-catalog.csv', mappingExportKit.categoryCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                        <Download size={16} />
                        Category catalog
                      </button>
                      <button type="button" onClick={() => downloadMappingText('budgeteer-receipt-classifier-terms.csv', mappingExportKit.classifierTermCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                        <Download size={16} />
                        Classifier terms
                      </button>
                    </div>
                    <button type="button" onClick={() => downloadMappingText('budgeteer-existing-receipt-mappings.csv', mappingExportKit.existingMappingsCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                      <Download size={16} />
                      Existing learned mappings
                    </button>
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4">
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-2">Prompt</span>
                        <textarea value={mappingExportKit.prompt} readOnly className={`${inputClass} min-h-[360px] font-mono text-xs resize-y`} />
                      </label>
                      <label className="min-w-0">
                        <span className="block text-xs font-medium text-gray-400 mb-2">CSV template</span>
                        <textarea value={mappingExportKit.templateCsv} readOnly className={`${inputClass} min-h-[360px] font-mono text-xs resize-y`} />
                      </label>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <label className="min-w-0">
                    <span className="block text-xs font-medium text-gray-400 mb-2">Paste mapping CSV</span>
                    <textarea
                      value={mappingCsvText}
                      onChange={(e) => handleMappingCsvChange(e.target.value)}
                      className={`${inputClass} min-h-[220px] font-mono text-xs resize-y`}
                      placeholder="merchantName,merchantKey,originalLabel,normalizedLabel,categoryId,categoryName,subcategoryId,subcategoryName,confidence,termType,term,isActive,notes"
                    />
                  </label>
                  <div className="flex flex-col gap-2">
                    <label className={`${secondaryBtn} flex items-center justify-center gap-2 cursor-pointer`}>
                      <FileUp size={16} />
                      Choose CSV
                      <input type="file" accept=".csv,text/csv" onChange={handleMappingFileChange} className="hidden" />
                    </label>
                    <button
                      type="button"
                      onClick={() => previewMappingImportMutation.mutate()}
                      disabled={!mappingCsvText.trim() || previewMappingImportMutation.isPending}
                      className={`${primaryBtn} flex items-center justify-center gap-2`}
                    >
                      {previewMappingImportMutation.isPending ? 'Previewing...' : 'Preview import'}
                    </button>
                  </div>
                </div>

                {previewMappingImportMutation.data && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(['create', 'update', 'unchanged', 'skipped', 'invalid'] as ReceiptMappingImportStatus[]).map((status) => (
                        <span key={status} className={`text-xs border rounded-full px-2.5 py-1 ${MAPPING_STATUS_CLASS[status]}`}>
                          {status}: {previewMappingImportMutation.data.counts[status]}
                        </span>
                      ))}
                      <span className="text-xs border border-gray-700 rounded-full px-2.5 py-1 text-gray-300">
                        total: {previewMappingImportMutation.data.counts.total}
                      </span>
                    </div>

                    <div className="border border-gray-800 rounded-xl overflow-hidden">
                      <div className="hidden xl:grid grid-cols-[72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-2 px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400">
                        <span>Row</span>
                        <span>Status</span>
                        <span>Merchant</span>
                        <span>Label</span>
                        <span>Category</span>
                        <span>Notes</span>
                      </div>
                      <div className="divide-y divide-gray-800 max-h-[360px] overflow-y-auto">
                        {previewMappingImportMutation.data.rows.map((row) => (
                          <div key={`${row.rowNumber}-${row.normalizedLabel}-${row.merchantKey}`} className="grid grid-cols-1 xl:grid-cols-[72px_96px_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-2 p-3 text-sm">
                            <span className="text-gray-500">#{row.rowNumber}</span>
                            <span className={`w-fit text-xs border rounded-full px-2 py-0.5 ${MAPPING_STATUS_CLASS[row.status]}`}>{row.status}</span>
                            <span className="min-w-0 truncate">{row.merchantName || row.merchantKey || 'Any merchant'}</span>
                            <span className="min-w-0 truncate" title={row.normalizedLabel}>{row.normalizedLabel || row.originalLabel}</span>
                            <span className="min-w-0 truncate">
                              {row.kind === 'term' ? `${row.termType}: ${row.term} (${row.isActive ? 'active' : 'inactive'})` : `${row.categoryName}${row.subcategoryName ? ` / ${row.subcategoryName}` : ''}`}
                            </span>
                            <span className={`min-w-0 ${row.errors.length > 0 ? 'text-red-300' : 'text-gray-500'}`}>
                              {row.errors.length > 0 ? row.errors.join('; ') : row.notes || `confidence ${row.confidence.toFixed(2)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-500">
                        Only valid create and update rows are saved. Invalid, skipped, and unchanged rows are left untouched.
                      </p>
                      <button
                        type="button"
                        onClick={() => confirmMappingImportMutation.mutate()}
                        disabled={confirmMappingImportMutation.isPending || previewMappingImportMutation.data.counts.create + previewMappingImportMutation.data.counts.update === 0}
                        className={`${primaryBtn} flex items-center gap-2`}
                      >
                        <Check size={16} />
                        {confirmMappingImportMutation.isPending ? 'Saving...' : 'Confirm import'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </main>
  )
}

export function NewReceiptPage() {
  const { id: householdId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [accountId, setAccountId] = useState('')
  const [parseError, setParseError] = useState('')

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

  const parseMutation = useMutation({
    mutationFn: async () => {
      if (receiptFile) {
        const form = new FormData()
        form.append('receipt', receiptFile)
        if (accountId) form.append('accountId', accountId)
        return (await api.post<Receipt>(`/households/${householdId}/receipts/upload`, form, {
          transformRequest: [(data, headers) => {
            delete headers['Content-Type']
            return data
          }],
        })).data
      }
      const payload: Record<string, unknown> = {
        rawText: rawText.trim() || undefined,
        accountId: accountId || undefined,
      }
      return (await api.post<Receipt>(`/households/${householdId}/receipts/parse`, payload)).data
    },
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      toast.success('Receipt parsed for review')
      navigate(`/households/${householdId}/receipts?receiptId=${receipt.id}`)
    },
    onError: (err) => {
      const message = readError(err, receiptFile ? 'Failed to upload receipt' : 'Failed to parse receipt')
      setParseError(message)
      toast.error(message)
    },
  })

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
      setFileName('')
      setReceiptFile(null)
      setParseError('Upload a PNG, JPEG, or PDF receipt')
      return
    }
    setFileName(file.name)
    setReceiptFile(file)
    setParseError('')
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

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <PageHeader
        title="Add receipt"
        action={(
          <Link to={`/households/${householdId}/receipts`} className={`${secondaryBtn} flex items-center gap-2`}>
            <ArrowLeft size={16} />
            Receipts
          </Link>
        )}
      />

      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ScanLine size={18} className="text-amber-400" />
          <h2 className="font-semibold">Import receipt</h2>
        </div>
        <form onSubmit={handleParse} className="space-y-4">
          <div className="block">
            <span className="block text-xs font-medium text-gray-400 mb-2">Image or scanned PDF</span>
            <input
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={handleFileChange}
              className="hidden"
              id="receipt-upload"
            />
            <label htmlFor="receipt-upload" className="flex items-center justify-center gap-2 border border-dashed border-gray-700 rounded-lg px-4 py-8 text-sm text-gray-400 hover:text-white hover:border-amber-400/60 transition-colors cursor-pointer">
              <Upload size={16} />
              {fileName || 'Choose receipt'}
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-400 mb-2">OCR text</span>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className={`${inputClass} min-h-[220px] resize-y`}
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
            {parseMutation.isPending ? (receiptFile ? 'Uploading...' : 'Parsing...') : (receiptFile ? 'Upload and parse receipt' : 'Parse receipt')}
          </button>
        </form>
      </section>
    </main>
  )
}

function ConfidenceBadge({ confidence }: { confidence: ReceiptConfidence }) {
  return <span className={`text-xs border rounded-full px-2 py-1 ${CONFIDENCE_CLASS[confidence]}`}>{confidence.toLowerCase()}</span>
}

function ReceiptConsumptionPanel({
  summary,
  isLoading,
  isFetching,
  period,
  startDate,
  endDate,
  customRangeValid,
  onPeriodChange,
  onStartDateChange,
  onEndDateChange,
  fmt,
}: {
  summary: ReceiptConsumptionSummary | undefined
  isLoading: boolean
  isFetching: boolean
  period: ReceiptSummaryPeriod
  startDate: string
  endDate: string
  customRangeValid: boolean
  onPeriodChange: (period: ReceiptSummaryPeriod) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  fmt: (value: number | string) => string
}) {
  const total = parseMoney(summary?.total)
  const categoryRows = summary?.byCategory ?? []

  return (
    <section className="border border-gray-800 rounded-xl p-3 bg-gray-950/40">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Receipt consumption</h3>
          <p className="mt-1 text-xs text-gray-500">
            {summary ? `${summary.itemCount} confirmed line${summary.itemCount === 1 ? '' : 's'} · ${fmt(summary.total)}` : 'Confirmed receipt lines'}
            {isFetching && !isLoading ? <span className="text-amber-300"> · Updating</span> : null}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_auto_auto] gap-2">
          <label className="min-w-0">
            <span className="block text-xs font-medium text-gray-400 mb-1.5">Period</span>
            <select value={period} onChange={(e) => onPeriodChange(e.target.value as ReceiptSummaryPeriod)} className={compactInputClass}>
              {RECEIPT_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label className="min-w-0">
                <span className="block text-xs font-medium text-gray-400 mb-1.5">Start</span>
                <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} className={compactInputClass} />
              </label>
              <label className="min-w-0">
                <span className="block text-xs font-medium text-gray-400 mb-1.5">End</span>
                <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} className={compactInputClass} />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!customRangeValid ? (
          <div className="rounded-lg border border-amber-800/60 bg-amber-900/20 px-3 py-6 text-center text-sm text-amber-200">
            Choose a custom start date before or equal to the end date.
          </div>
        ) : isLoading ? (
          <div className="min-h-32"><PageLoader /></div>
        ) : !summary || total <= 0 || categoryRows.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-8 text-center text-sm text-gray-500">
            No confirmed receipt consumption for this period.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-4 overflow-hidden rounded-full bg-gray-800 flex" aria-label="Receipt spend by category">
              {categoryRows.map((category, index) => {
                const amount = parseMoney(category.total)
                const percent = percentage(amount, total)
                return (
                  <div
                    key={category.categoryId ?? 'uncategorized'}
                    className="h-full"
                    style={{ width: `${percent}%`, backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                    title={`${category.categoryName}: ${fmt(category.total)} (${formatPercent(percent)})`}
                  />
                )
              })}
            </div>

            <div className="space-y-3">
              {categoryRows.map((category, index) => {
                const categoryAmount = parseMoney(category.total)
                const categoryPercent = percentage(categoryAmount, total)
                const subcategoryRows = (summary.bySubcategory ?? [])
                  .filter((subcategory) => sameId(subcategory.categoryId, category.categoryId))
                  .sort((a, b) => parseMoney(b.total) - parseMoney(a.total))
                const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]

                return (
                  <div key={category.categoryId ?? 'uncategorized'} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="truncate text-sm font-medium text-gray-100">{category.categoryName}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800">
                          <div className="h-full rounded-full" style={{ width: `${categoryPercent}%`, backgroundColor: color }} />
                        </div>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm font-medium text-gray-100">{fmt(category.total)}</p>
                        <p className="text-xs text-gray-500">{formatPercent(categoryPercent)} · {category.itemCount} item{category.itemCount === 1 ? '' : 's'}</p>
                      </div>
                    </div>

                    {subcategoryRows.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {subcategoryRows.map((subcategory) => {
                          const subcategoryAmount = parseMoney(subcategory.total)
                          const totalPercent = percentage(subcategoryAmount, total)
                          const categoryShare = percentage(subcategoryAmount, categoryAmount)
                          return (
                            <div key={`${subcategory.categoryId ?? 'uncategorized'}-${subcategory.subcategoryId ?? 'none'}`} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                              <div className="min-w-0 pl-5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate text-xs text-gray-300">{subcategory.subcategoryName}</span>
                                  <span className="shrink-0 text-xs text-gray-500">{formatPercent(categoryShare)} of category</span>
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-800">
                                  <div className="h-full rounded-full bg-gray-500" style={{ width: `${categoryShare}%` }} />
                                </div>
                              </div>
                              <div className="pl-5 text-left md:pl-0 md:text-right">
                                <p className="text-xs font-medium text-gray-300">{fmt(subcategory.total)}</p>
                                <p className="text-xs text-gray-500">{formatPercent(totalPercent)} total</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {summary.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-800/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
                {summary.warnings.map((warning) => (
                  <p key={warning} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {warning}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function ReceiptPreview({ receipt, previewUrl }: { receipt: Receipt; previewUrl: string | null }) {
  return (
    <aside className="min-w-0 border border-gray-800 rounded-xl overflow-hidden bg-gray-950 2xl:sticky 2xl:top-24">
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
      <div className="h-[420px] md:h-[560px] 2xl:h-[calc(100vh-190px)] bg-gray-950 flex items-center justify-center overflow-hidden">
        {!receipt.hasSourceFile ? (
          <div className="p-6 text-sm text-gray-500 text-center whitespace-pre-wrap overflow-auto max-h-full">
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

function draftNeedsReview(draft: LineDraft): boolean {
  return draft.confidence === 'LOW' || !draft.categoryId
}

function parseMoney(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0')
  return Number.isFinite(parsed) ? parsed : 0
}

function percentage(amount: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (amount / total) * 100))
}

function formatPercent(value: number): string {
  return `${value < 10 && value > 0 ? value.toFixed(1) : value.toFixed(0)}%`
}

function sameId(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null)
}

function readError(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 413) {
      return 'Receipt file is too large. Upload a file smaller than 10 MB.'
    }
    return (err.response?.data as { error?: string })?.error ?? fallback
  }
  if (err instanceof Error) return err.message
  return fallback
}
