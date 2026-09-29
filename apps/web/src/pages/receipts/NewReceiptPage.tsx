import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ScanLine, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { PageHeader } from '../../components/PageHeader'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { readError } from './helpers'
import type { AccountInfo, Receipt } from './types'

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

/** Upload a receipt file or paste OCR text; the parsed draft opens in the review pane. */
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
    if (!ACCEPTED_TYPES.includes(file.type)) {
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
