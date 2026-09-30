import { useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageHeader } from '../../components/PageHeader'
import { primaryBtn } from '../../lib/styles'
import { useFmt } from '../../hooks/useFmt'
import { IncomeHistoryChart } from './IncomeHistoryChart'
import { JobsTab } from './JobsTab'
import { OverridesTab } from './OverridesTab'
import { BonusesTab } from './BonusesTab'
import { JobModal } from './JobModal'
import { SalaryHistoryModal } from './SalaryHistoryModal'
import { OverrideModal } from './OverrideModal'
import { BonusModal } from './BonusModal'
import { PayslipImportModal } from './PayslipImportModal'
import { PayslipReviewModal } from './PayslipReviewModal'
import { TaxCardFromPayslipModal } from './TaxCardFromPayslipModal'
import { useIncomeData } from './useIncomeData'
import {
  useAllocationEditor, useBonusEditor, useJobEditor, useOverrideEditor, usePayslipImport, useSalaryEditor,
  useTaxCardEditor,
} from './useIncomeEditors'
import type { Tab } from './types'
import { IncomeTrashTab } from './IncomeTrashTab'
import { Page } from '../../components/Page'
import { TriangleAlert } from 'lucide-react'

/** Personal income: jobs & salary history, monthly overrides, bonuses and household allocations. */
export function IncomePage() {
  const fmt = useFmt()
  const [activeTab, setActiveTab] = useState<Tab>('jobs')

  const {
    isProxy, targetUserId, proxyUserName, baseCurrency, currencies,
    jobs, isLoading, households, allJobsOverrides, allJobsBonuses, taxCards,
  } = useIncomeData(activeTab)

  const jobEditor = useJobEditor(targetUserId)
  const salaryEditor = useSalaryEditor(jobs, taxCards, baseCurrency, targetUserId)
  const overrideEditor = useOverrideEditor(jobs, taxCards, targetUserId)
  const bonusEditor = useBonusEditor(baseCurrency, targetUserId)
  const allocations = useAllocationEditor()
  const taxCardEditor = useTaxCardEditor()
  const payslipImport = usePayslipImport()

  const { confirmCloseJob, setConfirmCloseJob, closeJobMutation } = jobEditor
  const { confirmDeleteBonus, setConfirmDeleteBonus, deleteBonusMutation } = bonusEditor
  const { confirmDeleteOverride, setConfirmDeleteOverride, deleteOverrideMutation } = overrideEditor
  const {
    payslipImportJobId, setPayslipImportJobId, payslipReviewData, payslipReviewJobId,
    payslipConfirmMutation, handlePayslipConfirm, reviewExtraction, closeReview,
  } = payslipImport
  const {
    taxCardPayslipJobId, setTaxCardPayslipJobId, taxCardPayslipData, setTaxCardPayslipData,
    taxCardFromPayslipMutation, closeTaxCardPayslip,
  } = taxCardEditor

  return (
    <>
      <Page template="list" className="space-y-8">
        <PageHeader title="Personal Income" subtitle="Manage your income sources and household allocations." />

        {/* ── Proxy banner ────────────────────────────────────────────────── */}
        {isProxy && proxyUserName && (
          <div className="bg-orange-950 border border-orange-700 text-orange-300 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <TriangleAlert size={16} className="shrink-0 text-orange-400" aria-hidden="true" />
            <span>Entering income on behalf of <strong>{proxyUserName}</strong></span>
          </div>
        )}

        {/* ── Income History Chart ─────────────────────────────────────────── */}
        <IncomeHistoryChart targetUserId={targetUserId} fmt={fmt} />

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div>
          <div className="flex border-b border-gray-800 mb-6">
            {([['jobs', 'Jobs & Salary'], ['overrides', 'Monthly Overrides'], ['bonuses', 'Bonuses'], ['trash', 'Trash']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'jobs' && (
            <JobsTab
              jobs={jobs}
              isLoading={isLoading}
              households={households}
              taxCards={taxCards}
              fmt={fmt}
              jobEditor={jobEditor}
              salaryEditor={salaryEditor}
              taxCardEditor={taxCardEditor}
              allocations={allocations}
            />
          )}

          {activeTab === 'overrides' && (
            <OverridesTab
              jobs={jobs}
              allJobsOverrides={allJobsOverrides}
              fmt={fmt}
              overrideEditor={overrideEditor}
              payslipImport={payslipImport}
            />
          )}

          {activeTab === 'bonuses' && (
            <BonusesTab jobs={jobs} allJobsBonuses={allJobsBonuses} fmt={fmt} bonusEditor={bonusEditor} />
          )}

          {activeTab === 'trash' && <IncomeTrashTab targetUserId={targetUserId ?? undefined} fmt={fmt} />}
        </div>
      </Page>

      {/* ── Add/Edit Job modal ──────────────────────────────────────────────── */}
      {(jobEditor.showAddJob || jobEditor.editingJob) && <JobModal editor={jobEditor} />}

      {/* ── Salary History modal ────────────────────────────────────────────── */}
      {salaryEditor.salaryJobId && (
        <SalaryHistoryModal editor={salaryEditor} jobs={jobs} currencies={currencies} baseCurrency={baseCurrency} fmt={fmt} />
      )}

      {/* ── Add Override modal ──────────────────────────────────────────────── */}
      {overrideEditor.overrideJobId && <OverrideModal editor={overrideEditor} jobs={jobs} baseCurrency={baseCurrency} />}

      {/* ── Add/Edit Bonus modal ────────────────────────────────────────────── */}
      {(bonusEditor.bonusJobId || bonusEditor.editingBonus) && (
        <BonusModal editor={bonusEditor} jobs={jobs} currencies={currencies} baseCurrency={baseCurrency} />
      )}

      {/* ── Confirm close job ───────────────────────────────────────────────── */}
      {confirmCloseJob && (
        <ConfirmDialog
          title="Close job"
          onClose={() => setConfirmCloseJob(null)}
          onConfirm={() => { closeJobMutation.mutate(confirmCloseJob.id); setConfirmCloseJob(null) }}
          pending={closeJobMutation.isPending}
          confirmClassName={primaryBtn}
          confirmLabel="Close job"
        >
          <p className="text-gray-300 text-sm mb-6">
            Close <span className="font-semibold text-white">{confirmCloseJob.name}</span>? This will set today as the end date. You can re-open it by editing the job.
          </p>
        </ConfirmDialog>
      )}

      {/* ── Confirm delete bonus ────────────────────────────────────────────── */}
      {confirmDeleteBonus && (
        <ConfirmDialog
          title="Move bonus to trash"
          onClose={() => setConfirmDeleteBonus(null)}
          onConfirm={() => { deleteBonusMutation.mutate(confirmDeleteBonus); setConfirmDeleteBonus(null) }}
          pending={deleteBonusMutation.isPending}
          confirmLabel="Move to trash"
        >
          <p className="text-gray-300 text-sm mb-6">Move this bonus to the trash? It stops counting toward your income. You can restore it from the Trash tab.</p>
        </ConfirmDialog>
      )}

      {/* ── Payslip Import modal ───────────────────────────────────────────── */}
      {payslipImportJobId && (
        <PayslipImportModal
          jobId={payslipImportJobId}
          jobName={jobs.find((j) => j.id === payslipImportJobId)?.name ?? ''}
          onClose={() => setPayslipImportJobId(null)}
          onExtracted={reviewExtraction}
        />
      )}

      {/* ── Payslip Review modal ───────────────────────────────────────────── */}
      {payslipReviewData && payslipReviewJobId && (
        <PayslipReviewModal
          extraction={payslipReviewData}
          jobName={jobs.find((j) => j.id === payslipReviewJobId)?.name ?? ''}
          onClose={closeReview}
          onConfirm={handlePayslipConfirm}
          isPending={payslipConfirmMutation.isPending}
        />
      )}

      {/* ── Tax card import: payslip picker ───────────────────────────────── */}
      {taxCardPayslipJobId && !taxCardPayslipData && (
        <PayslipImportModal
          jobId={taxCardPayslipJobId}
          jobName={jobs.find((j) => j.id === taxCardPayslipJobId)?.name ?? ''}
          onClose={() => setTaxCardPayslipJobId(null)}
          onExtracted={(data) => setTaxCardPayslipData(data)}
        />
      )}

      {/* ── Tax card import: review & save ────────────────────────────────── */}
      {taxCardPayslipData && taxCardPayslipJobId && (
        <TaxCardFromPayslipModal
          extraction={taxCardPayslipData}
          jobName={jobs.find((j) => j.id === taxCardPayslipJobId)?.name ?? ''}
          onClose={closeTaxCardPayslip}
          onConfirm={(taxCard) => taxCardFromPayslipMutation.mutate({ jobId: taxCardPayslipJobId, taxCard })}
          isPending={taxCardFromPayslipMutation.isPending}
        />
      )}

      {/* ── Confirm delete override ─────────────────────────────────────────── */}
      {confirmDeleteOverride && (
        <ConfirmDialog
          title="Move override to trash"
          onClose={() => setConfirmDeleteOverride(null)}
          onConfirm={() => { deleteOverrideMutation.mutate(confirmDeleteOverride); setConfirmDeleteOverride(null) }}
          pending={deleteOverrideMutation.isPending}
          confirmLabel="Move to trash"
        >
          <p className="text-gray-300 text-sm mb-6">Move this monthly override to the trash? That month goes back to your regular salary. You can restore it from the Trash tab.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
