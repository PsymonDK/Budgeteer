import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Download, FileText, FileUp, Plus } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { PageLoader } from '../../components/LoadingSpinner'
import { primaryBtn, secondaryBtn } from '../../lib/styles'
import { ReceiptConsumptionPanel } from './ReceiptConsumptionPanel'
import { ReceiptHistoryList } from './ReceiptHistoryList'
import { ReceiptReview } from './ReceiptReview'
import { MappingTrainingModal, type MappingTab } from './MappingTrainingModal'
import { useReceipt, useReceipts } from './queries'

/** Household receipts: consumption summary, receipt history and the review pane (`?receiptId=`). */
export function ReceiptsPage() {
  const { id } = useParams<{ id: string }>()
  const householdId = id ?? ''
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth >= 1280)
  const [mappingModalOpen, setMappingModalOpen] = useState(false)
  const [mappingTab, setMappingTab] = useState<MappingTab>('export')

  const { data: receipts = [], isLoading: receiptsLoading } = useReceipts(householdId)
  const { data: selectedReceipt, isLoading: receiptLoading, isError: receiptError } = useReceipt(householdId, selectedReceiptId)

  useEffect(() => {
    const receiptId = searchParams.get('receiptId')
    if (receiptId) setSelectedReceiptId(receiptId)
  }, [searchParams])

  function selectReceipt(receiptId: string) {
    setSelectedReceiptId(receiptId)
    setSearchParams({ receiptId })
  }

  function handleDeleted(receiptId: string) {
    if (selectedReceiptId === receiptId) {
      setSelectedReceiptId(null)
      setSearchParams({})
    }
  }

  function openMappingModal(tab: MappingTab) {
    setMappingTab(tab)
    setMappingModalOpen(true)
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
        <ReceiptConsumptionPanel householdId={householdId} />
      </div>

      <div className={`grid gap-4 min-w-0 ${isHistoryOpen ? 'xl:grid-cols-[300px_minmax(0,1fr)]' : 'xl:grid-cols-[56px_minmax(0,1fr)]'}`}>
        <aside className="min-w-0">
          <ReceiptHistoryList
            receipts={receipts}
            isLoading={receiptsLoading}
            isOpen={isHistoryOpen}
            onToggle={() => setIsHistoryOpen((open) => !open)}
            selectedId={selectedReceiptId}
            onSelect={selectReceipt}
          />
        </aside>

        <section className="min-w-0 bg-gray-900 border border-gray-800 rounded-xl min-h-[calc(100vh-150px)] overflow-hidden">
          {!selectedReceiptId ? (
            <div className="h-full min-h-[520px] flex flex-col items-center justify-center text-center text-gray-500 px-6">
              <FileText size={36} className="mb-4 text-gray-700" />
              <p>Select a receipt or add a new one.</p>
            </div>
          ) : receiptError ? (
            <div className="h-full min-h-[520px] flex flex-col items-center justify-center text-center text-gray-500 px-6">
              <FileText size={36} className="mb-4 text-gray-700" />
              <p>This receipt could not be loaded. It may have been deleted.</p>
            </div>
          ) : receiptLoading || !selectedReceipt ? (
            <PageLoader />
          ) : (
            <ReceiptReview key={selectedReceipt.id} householdId={householdId} receipt={selectedReceipt} onDeleted={handleDeleted} />
          )}
        </section>
      </div>

      <MappingTrainingModal
        householdId={householdId}
        open={mappingModalOpen}
        tab={mappingTab}
        onTabChange={setMappingTab}
        onClose={() => setMappingModalOpen(false)}
      />
    </main>
  )
}
