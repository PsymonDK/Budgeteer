import { useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clipboard, Download, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { PageLoader } from '../../components/LoadingSpinner'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'
import { MAPPING_STATUS_CLASS, downloadText, readError } from './helpers'
import type { ReceiptMappingExportKit, ReceiptMappingImportPreview, ReceiptMappingImportStatus } from './types'

export type MappingTab = 'export' | 'import'

interface MappingTrainingModalProps {
  householdId: string
  open: boolean
  tab: MappingTab
  onTabChange: (tab: MappingTab) => void
  onClose: () => void
}

/**
 * Export an LLM prompt kit for categorising receipt lines, and import the CSV it
 * produces as learned mappings. Stays mounted while closed so a pasted CSV and
 * its preview survive closing and reopening the modal.
 */
export function MappingTrainingModal({ householdId, open, tab, onTabChange, onClose }: MappingTrainingModalProps) {
  const queryClient = useQueryClient()
  const [csvText, setCsvText] = useState('')

  const { data: exportKit, isLoading: exportLoading } = useQuery<ReceiptMappingExportKit>({
    queryKey: ['receipt-mapping-export-kit', householdId],
    queryFn: async () => (await api.get<ReceiptMappingExportKit>(`/households/${householdId}/receipt-mappings/export-kit`)).data,
    enabled: !!householdId && open,
  })

  const previewMutation = useMutation({
    mutationFn: async () => (await api.post<ReceiptMappingImportPreview>(`/households/${householdId}/receipt-mappings/import-preview`, { csvText })).data,
    onError: (err) => toast.error(readError(err, 'Failed to preview mappings')),
  })

  const confirmMutation = useMutation({
    mutationFn: async () => (await api.post<ReceiptMappingImportPreview>(`/households/${householdId}/receipt-mappings/import-confirm`, { csvText })).data,
    onSuccess: (preview) => {
      queryClient.invalidateQueries({ queryKey: ['receipt-mapping-export-kit', householdId] })
      queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
      previewMutation.reset()
      setCsvText('')
      toast.success(`${preview.counts.create + preview.counts.update} mapping${preview.counts.create + preview.counts.update === 1 ? '' : 's'} saved`)
    },
    onError: (err) => toast.error(readError(err, 'Failed to import mappings')),
  })

  function handleCsvChange(value: string) {
    setCsvText(value)
    previewMutation.reset()
    confirmMutation.reset()
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text()
      .then(handleCsvChange)
      .catch(() => toast.error('Failed to read mapping CSV'))
  }

  async function copyPrompt() {
    if (!exportKit) return
    try {
      await navigator.clipboard.writeText(exportKit.prompt)
      toast.success('Prompt copied')
    } catch {
      toast.error('Clipboard copy failed')
    }
  }

  if (!open) return null

  const preview = previewMutation.data

  return (
    <Modal title="Receipt mapping training" size="xl" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
          <button
            type="button"
            onClick={() => onTabChange('export')}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${tab === 'export' ? 'bg-amber-400 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            Export LLM kit
          </button>
          <button
            type="button"
            onClick={() => onTabChange('import')}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${tab === 'import' ? 'bg-amber-400 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            Import mappings
          </button>
        </div>

        {tab === 'export' ? (
          <div className="space-y-4">
            {exportLoading ? (
              <PageLoader />
            ) : !exportKit ? (
              <p className="text-sm text-gray-500">Mapping kit could not be loaded.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                  <button type="button" onClick={copyPrompt} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                    <Clipboard size={16} />
                    Copy prompt
                  </button>
                  <button type="button" onClick={() => downloadText('budgeteer-receipt-mapping-prompt.txt', exportKit.prompt, 'text/plain')} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                    <Download size={16} />
                    Prompt
                  </button>
                  <button type="button" onClick={() => downloadText('budgeteer-receipt-mapping-template.csv', exportKit.templateCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                    <Download size={16} />
                    Template CSV
                  </button>
                  <button type="button" onClick={() => downloadText('budgeteer-receipt-category-catalog.csv', exportKit.categoryCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                    <Download size={16} />
                    Category catalog
                  </button>
                  <button type="button" onClick={() => downloadText('budgeteer-receipt-classifier-terms.csv', exportKit.classifierTermCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                    <Download size={16} />
                    Classifier terms
                  </button>
                </div>
                <button type="button" onClick={() => downloadText('budgeteer-existing-receipt-mappings.csv', exportKit.existingMappingsCsv)} className={`${secondaryBtn} flex items-center justify-center gap-2`}>
                  <Download size={16} />
                  Existing learned mappings
                </button>
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4">
                  <label className="min-w-0">
                    <span className="block text-xs font-medium text-gray-400 mb-2">Prompt</span>
                    <textarea value={exportKit.prompt} readOnly className={`${inputClass} min-h-[360px] font-mono text-xs resize-y`} />
                  </label>
                  <label className="min-w-0">
                    <span className="block text-xs font-medium text-gray-400 mb-2">CSV template</span>
                    <textarea value={exportKit.templateCsv} readOnly className={`${inputClass} min-h-[360px] font-mono text-xs resize-y`} />
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
                  value={csvText}
                  onChange={(e) => handleCsvChange(e.target.value)}
                  className={`${inputClass} min-h-[220px] font-mono text-xs resize-y`}
                  placeholder="merchantName,merchantKey,originalLabel,normalizedLabel,categoryId,categoryName,subcategoryId,subcategoryName,confidence,termType,term,isActive,notes"
                />
              </label>
              <div className="flex flex-col gap-2">
                <label className={`${secondaryBtn} flex items-center justify-center gap-2 cursor-pointer`}>
                  <FileUp size={16} />
                  Choose CSV
                  <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => previewMutation.mutate()}
                  disabled={!csvText.trim() || previewMutation.isPending}
                  className={`${primaryBtn} flex items-center justify-center gap-2`}
                >
                  {previewMutation.isPending ? 'Previewing...' : 'Preview import'}
                </button>
              </div>
            </div>

            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(['create', 'update', 'unchanged', 'skipped', 'invalid'] as ReceiptMappingImportStatus[]).map((status) => (
                    <span key={status} className={`text-xs border rounded-full px-2.5 py-1 ${MAPPING_STATUS_CLASS[status]}`}>
                      {status}: {preview.counts[status]}
                    </span>
                  ))}
                  <span className="text-xs border border-gray-700 rounded-full px-2.5 py-1 text-gray-300">
                    total: {preview.counts.total}
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
                    {preview.rows.map((row) => (
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
                    onClick={() => confirmMutation.mutate()}
                    disabled={confirmMutation.isPending || preview.counts.create + preview.counts.update === 0}
                    className={`${primaryBtn} flex items-center gap-2`}
                  >
                    <Check size={16} />
                    {confirmMutation.isPending ? 'Saving...' : 'Confirm import'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
