// State + mutations behind each income dialog/section. The hooks are called
// from IncomePage so their state lives as long as the page, exactly as when
// it was declared directly in the page.

import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { getApiError } from '../../lib/apiError'
import { calcDanishDeductions, type LiveDeductions } from '../../lib/danishTaxPreview'
import type { PayslipExtraction } from '../../lib/parsePayslipCsv'
import {
  buildTaxCardPayload, deductionSubmission, emptyBonus, emptyDeductionOverrides, emptyJob, emptyOverride,
  emptySalary, emptyTaxCard, taxCardPreviewSettings, toDateInput,
} from './helpers'
import type {
  Bonus, BonusForm, DeductionOverrides, Job, JobForm, OverrideForm, SalaryForm, SalaryRecord, TaxCardDraft,
  TaxCardForm, TaxCardSettings,
} from './types'

type TargetUserId = string | null | undefined

// ── Jobs ──────────────────────────────────────────────────────────────────────

export function useJobEditor(targetUserId: TargetUserId) {
  const queryClient = useQueryClient()
  const [showAddJob, setShowAddJob] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [jobForm, setJobForm] = useState<JobForm>(emptyJob)
  const [jobFormError, setJobFormError] = useState('')
  const [confirmCloseJob, setConfirmCloseJob] = useState<Job | null>(null)

  const createJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.post(`/users/${targetUserId}/jobs`, {
        name: data.name, employer: data.employer || undefined, country: data.country,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.jobsAll() }); setShowAddJob(false); setJobForm(emptyJob()); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateJobMutation = useMutation({
    mutationFn: (data: JobForm) =>
      api.put(`/users/${targetUserId}/jobs/${editingJob!.id}`, {
        name: data.name, employer: data.employer || undefined, country: data.country,
        startDate: data.startDate, endDate: data.endDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.jobsAll() }); setEditingJob(null); setJobForm(emptyJob()); setJobFormError(''); toast.success('Job saved') },
    onError: (err) => { if (axios.isAxiosError(err)) setJobFormError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const closeJobMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to close job')),
    mutationFn: (jobId: string) => api.delete(`/users/${targetUserId}/jobs/${jobId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.jobsAll() }); toast.success('Job closed') },
  })

  function openAddJob() {
    setShowAddJob(true); setJobForm(emptyJob()); setJobFormError('')
  }

  function openEditJob(job: Job) {
    setJobForm({ name: job.name, employer: job.employer ?? '', country: job.country ?? 'DK', startDate: toDateInput(job.startDate), endDate: job.endDate ? toDateInput(job.endDate) : '' })
    setJobFormError('')
    setEditingJob(job)
  }

  function closeJobModal() {
    setShowAddJob(false); setEditingJob(null)
  }

  function handleJobSubmit(e: FormEvent) {
    e.preventDefault(); setJobFormError('')
    if (editingJob) updateJobMutation.mutate(jobForm)
    else createJobMutation.mutate(jobForm)
  }

  return {
    showAddJob, editingJob, jobForm, setJobForm, jobFormError, confirmCloseJob, setConfirmCloseJob,
    createJobMutation, updateJobMutation, closeJobMutation,
    openAddJob, openEditJob, closeJobModal, handleJobSubmit,
  }
}
export type JobEditor = ReturnType<typeof useJobEditor>

// ── Salary history ────────────────────────────────────────────────────────────

export function useSalaryEditor(jobs: Job[], taxCards: Record<string, TaxCardSettings[]>, baseCurrency: string) {
  const queryClient = useQueryClient()
  const [salaryJobId, setSalaryJobId] = useState<string | null>(null)
  const [salaryForm, setSalaryForm] = useState<SalaryForm>(emptySalary(''))
  const [salaryError, setSalaryError] = useState('')
  const [editingSalary, setEditingSalary] = useState<SalaryRecord | null>(null)
  const [salaryDeductionOverrides, setSalaryDeductionOverrides] = useState<DeductionOverrides>(emptyDeductionOverrides())

  const { data: salaryRecords = [] } = useQuery<SalaryRecord[]>({
    queryKey: qk.salary(salaryJobId),
    queryFn: async () => (await api.get<SalaryRecord[]>(`/jobs/${salaryJobId}/salary`)).data,
    enabled: !!salaryJobId,
  })

  const addSalaryMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: SalaryForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const { net, deductionPayload } = deductionSubmission(form.grossAmount, form.netAmount, deductionOverrides, liveCalc)
      return api.post(`/jobs/${salaryJobId}/salary`, {
        grossAmount: parseFloat(form.grossAmount), netAmount: net, effectiveFrom: form.effectiveFrom,
        ...(form.currencyCode && form.currencyCode !== baseCurrency ? { currencyCode: form.currencyCode } : {}),
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary(salaryJobId) })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
      setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('')
      toast.success('Salary record added')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setSalaryError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateSalaryMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: SalaryForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const { net, deductionPayload } = deductionSubmission(form.grossAmount, form.netAmount, deductionOverrides, liveCalc)
      return api.put(`/jobs/${salaryJobId}/salary/${editingSalary!.id}`, {
        grossAmount: parseFloat(form.grossAmount), netAmount: net, effectiveFrom: form.effectiveFrom,
        ...(form.currencyCode && form.currencyCode !== baseCurrency ? { currencyCode: form.currencyCode } : {}),
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary(salaryJobId) })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
      setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('')
      toast.success('Salary record updated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setSalaryError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteSalaryMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete salary record')),
    mutationFn: (salaryId: string) => api.delete(`/jobs/${salaryJobId}/salary/${salaryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salary(salaryJobId) })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
      toast.success('Salary record deleted')
    },
  })

  // ── DK tax card context ───────────────────────────────────────────────────

  const salaryJob = jobs.find((j) => j.id === salaryJobId) ?? null

  const activeTaxCard = useMemo((): TaxCardSettings | null => {
    if (!salaryJobId) return null
    const cards = taxCards[salaryJobId] ?? []
    return cards.length > 0 ? cards[0] : null
  }, [salaryJobId, taxCards])

  const salaryLiveCalc = useMemo((): LiveDeductions | null => {
    const gross = parseFloat(salaryForm.grossAmount)
    if (!salaryJob || salaryJob.country !== 'DK' || !activeTaxCard || !gross) return null
    return calcDanishDeductions(gross, taxCardPreviewSettings(activeTaxCard))
  }, [salaryForm.grossAmount, salaryJob, activeTaxCard])

  function openSalary(jobId: string) {
    setSalaryJobId(jobId); setSalaryForm(emptySalary(baseCurrency)); setSalaryError('')
  }

  function closeSalary() {
    setSalaryJobId(null); setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryError('')
  }

  function startEditSalary(r: SalaryRecord) {
    setEditingSalary(r); setSalaryForm({ grossAmount: r.grossAmount, netAmount: r.netAmount, effectiveFrom: r.effectiveFrom.slice(0, 10), currencyCode: r.currencyCode ?? baseCurrency }); setSalaryError('')
  }

  function cancelEditSalary() {
    setEditingSalary(null); setSalaryForm(emptySalary(baseCurrency)); setSalaryDeductionOverrides(emptyDeductionOverrides()); setSalaryError('')
  }

  function handleSalarySubmit(e: FormEvent) {
    e.preventDefault()
    const payload = { form: salaryForm, deductionOverrides: salaryDeductionOverrides, liveCalc: salaryLiveCalc }
    if (editingSalary) updateSalaryMutation.mutate(payload); else addSalaryMutation.mutate(payload)
  }

  return {
    salaryJobId, salaryForm, setSalaryForm, salaryError, editingSalary,
    salaryDeductionOverrides, setSalaryDeductionOverrides, salaryRecords,
    addSalaryMutation, updateSalaryMutation, deleteSalaryMutation,
    salaryJob, activeTaxCard, salaryLiveCalc,
    openSalary, closeSalary, startEditSalary, cancelEditSalary, handleSalarySubmit,
  }
}
export type SalaryEditor = ReturnType<typeof useSalaryEditor>

// ── Monthly overrides ─────────────────────────────────────────────────────────

export function useOverrideEditor(jobs: Job[], taxCards: Record<string, TaxCardSettings[]>) {
  const queryClient = useQueryClient()
  const [overrideJobId, setOverrideJobId] = useState<string | null>(null)
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(emptyOverride)
  const [overrideError, setOverrideError] = useState('')
  const [overrideDeductionOpen, setOverrideDeductionOpen] = useState(false)
  const [overrideDeductionOverrides, setOverrideDeductionOverrides] = useState<DeductionOverrides>(emptyDeductionOverrides())
  const [confirmDeleteOverride, setConfirmDeleteOverride] = useState<{ jobId: string; overrideId: string } | null>(null)

  const upsertOverrideMutation = useMutation({
    mutationFn: ({ form, deductionOverrides, liveCalc }: { form: OverrideForm; deductionOverrides: DeductionOverrides; liveCalc: LiveDeductions | null }) => {
      const { net, deductionPayload } = deductionSubmission(form.grossAmount, form.netAmount, deductionOverrides, liveCalc)
      return api.post(`/jobs/${overrideJobId}/overrides`, {
        year: parseInt(form.year), month: parseInt(form.month),
        grossAmount: parseFloat(form.grossAmount), netAmount: net,
        note: form.note || undefined,
        ...deductionPayload,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.allOverridesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      setOverrideForm(emptyOverride); setOverrideDeductionOverrides(emptyDeductionOverrides()); setOverrideDeductionOpen(false); setOverrideError('')
      toast.success('Monthly override saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setOverrideError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteOverrideMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete override')),
    mutationFn: ({ jobId, overrideId }: { jobId: string; overrideId: string }) =>
      api.delete(`/jobs/${jobId}/overrides/${overrideId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.allOverridesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      toast.success('Override deleted')
    },
  })

  const overrideJob = jobs.find((j) => j.id === overrideJobId) ?? null

  const overrideActiveTaxCard = useMemo((): TaxCardSettings | null => {
    if (!overrideJobId) return null
    const cards = taxCards[overrideJobId] ?? []
    return cards.length > 0 ? cards[0] : null
  }, [overrideJobId, taxCards])

  const overrideLiveCalc = useMemo((): LiveDeductions | null => {
    const gross = parseFloat(overrideForm.grossAmount)
    if (!overrideJob || overrideJob.country !== 'DK' || !overrideActiveTaxCard || !gross) return null
    return calcDanishDeductions(gross, taxCardPreviewSettings(overrideActiveTaxCard))
  }, [overrideForm.grossAmount, overrideJob, overrideActiveTaxCard])

  function openOverride(jobId: string) {
    setOverrideJobId(jobId); setOverrideForm(emptyOverride); setOverrideError('')
  }

  function closeOverride() {
    setOverrideJobId(null); setOverrideDeductionOpen(false); setOverrideDeductionOverrides(emptyDeductionOverrides())
  }

  function handleOverrideSubmit(e: FormEvent) {
    e.preventDefault(); upsertOverrideMutation.mutate({ form: overrideForm, deductionOverrides: overrideDeductionOverrides, liveCalc: overrideLiveCalc })
  }

  return {
    overrideJobId, overrideForm, setOverrideForm, overrideError,
    overrideDeductionOpen, setOverrideDeductionOpen, overrideDeductionOverrides, setOverrideDeductionOverrides,
    confirmDeleteOverride, setConfirmDeleteOverride,
    upsertOverrideMutation, deleteOverrideMutation,
    overrideJob, overrideActiveTaxCard, overrideLiveCalc,
    openOverride, closeOverride, handleOverrideSubmit,
  }
}
export type OverrideEditor = ReturnType<typeof useOverrideEditor>

// ── Bonuses ───────────────────────────────────────────────────────────────────

export function useBonusEditor(baseCurrency: string) {
  const queryClient = useQueryClient()
  const [bonusJobId, setBonusJobId] = useState<string | null>(null)
  const [editingBonus, setEditingBonus] = useState<Bonus | null>(null)
  const [bonusForm, setBonusForm] = useState<BonusForm>(emptyBonus(''))
  const [bonusError, setBonusError] = useState('')
  const [confirmDeleteBonus, setConfirmDeleteBonus] = useState<{ jobId: string; bonusId: string } | null>(null)

  const createBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.post(`/jobs/${bonusJobId}/bonuses`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
        ...(data.currencyCode && data.currencyCode !== baseCurrency ? { currencyCode: data.currencyCode } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.allBonusesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      setBonusJobId(null); setBonusForm(emptyBonus(baseCurrency)); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateBonusMutation = useMutation({
    mutationFn: (data: BonusForm) =>
      api.put(`/jobs/${editingBonus!.jobId}/bonuses/${editingBonus!.id}`, {
        label: data.label, grossAmount: parseFloat(data.grossAmount), netAmount: parseFloat(data.netAmount),
        paymentDate: data.paymentDate, includeInBudget: data.includeInBudget,
        budgetMode: data.includeInBudget && data.budgetMode ? data.budgetMode : undefined,
        currencyCode: data.currencyCode !== baseCurrency ? data.currencyCode : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.allBonusesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      setEditingBonus(null); setBonusForm(emptyBonus(baseCurrency)); setBonusError('')
      toast.success('Bonus saved')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setBonusError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const deleteBonusMutation = useMutation({
    onError: (err) => toast.error(getApiError(err, 'Failed to delete bonus')),
    mutationFn: ({ jobId, bonusId }: { jobId: string; bonusId: string }) =>
      api.delete(`/jobs/${jobId}/bonuses/${bonusId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.allBonusesAll() }); queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() }); toast.success('Bonus deleted') },
  })

  function openAddBonus(jobId: string) {
    setBonusJobId(jobId); setBonusForm(emptyBonus(baseCurrency)); setBonusError('')
  }

  function openEditBonus(b: Bonus) {
    setEditingBonus(b); setBonusForm({ label: b.label, grossAmount: b.grossAmount, netAmount: b.netAmount, paymentDate: toDateInput(b.paymentDate), includeInBudget: b.includeInBudget, budgetMode: b.budgetMode ?? '', currencyCode: b.currencyCode ?? baseCurrency }); setBonusError('')
  }

  function closeBonus() {
    setBonusJobId(null); setEditingBonus(null)
  }

  function handleBonusSubmit(e: FormEvent) {
    e.preventDefault(); if (editingBonus) updateBonusMutation.mutate(bonusForm); else createBonusMutation.mutate(bonusForm)
  }

  return {
    bonusJobId, editingBonus, bonusForm, setBonusForm, bonusError, confirmDeleteBonus, setConfirmDeleteBonus,
    createBonusMutation, updateBonusMutation, deleteBonusMutation,
    openAddBonus, openEditBonus, closeBonus, handleBonusSubmit,
  }
}
export type BonusEditor = ReturnType<typeof useBonusEditor>

// ── Household allocations ─────────────────────────────────────────────────────

export function useAllocationEditor() {
  const queryClient = useQueryClient()
  const [pendingAllocations, setPendingAllocations] = useState<Record<string, string>>({})
  const [allocError, setAllocError] = useState('')
  const [allocationsDirty, setAllocationsDirty] = useState(false)

  // Saves every edited allocation for one job, one request at a time. Only that
  // job's pending edits are cleared, so unsaved edits on other jobs survive.
  const allocMutation = useMutation({
    mutationFn: async ({ jobId, changes }: { jobId: string; changes: { householdId: string; pct: number }[] }) => {
      for (const { householdId, pct } of changes) {
        if (pct === 0) await api.delete(`/income/${jobId}/allocations/${householdId}`)
        else await api.put(`/income/${jobId}/allocations/${householdId}`, { allocationPct: pct })
      }
    },
    onSuccess: (_data, { jobId }) => {
      setPendingAllocations((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${jobId}:`)))
        setAllocationsDirty(Object.keys(next).length > 0)
        return next
      })
      setAllocError('')
      toast.success('Allocations saved')
    },
    onError: (err) => setAllocError(getApiError(err, 'Failed to save allocation')),
    // Refetch on failure too: earlier requests in the batch may have succeeded
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.jobsAll() }),
  })

  function getAllocationPct(job: Job, householdId: string): string {
    const key = `${job.id}:${householdId}`
    if (key in pendingAllocations) return pendingAllocations[key]
    // Edits save to the household's default year, so show that year's value (not a retired year's)
    const alloc = job.allocations.find((a) => a.isDefaultYear && a.budgetYear.household.id === householdId)
    return alloc ? alloc.allocationPct : '0'
  }

  function setAllocation(jobId: string, householdId: string, value: string) {
    setPendingAllocations((prev) => ({ ...prev, [`${jobId}:${householdId}`]: value })); setAllocationsDirty(true)
  }

  function hasPendingFor(jobId: string) {
    return allocationsDirty && Object.keys(pendingAllocations).some((k) => k.startsWith(`${jobId}:`))
  }

  function saveAllocations(job: Job) {
    setAllocError('')
    const dirty = Object.entries(pendingAllocations).filter(([key]) => key.startsWith(`${job.id}:`))
    if (dirty.length === 0) return
    allocMutation.mutate({
      jobId: job.id,
      changes: dirty.map(([key, value]) => ({ householdId: key.split(':')[1], pct: parseFloat(value) || 0 })),
    })
  }

  function discardAllocations(jobId: string) {
    setPendingAllocations((p) => {
      const next = { ...p }
      Object.keys(next).filter((k) => k.startsWith(`${jobId}:`)).forEach((k) => delete next[k])
      return next
    }); setAllocationsDirty(false)
  }

  return { allocError, allocMutation, getAllocationPct, setAllocation, hasPendingFor, saveAllocations, discardAllocations }
}
export type AllocationEditor = ReturnType<typeof useAllocationEditor>

// ── Tax cards ─────────────────────────────────────────────────────────────────

export function useTaxCardEditor() {
  const queryClient = useQueryClient()
  const [taxCardJobId, setTaxCardJobId] = useState<string | null>(null)
  const [showTaxCardForm, setShowTaxCardForm] = useState(false)
  const [taxCardForm, setTaxCardForm] = useState<TaxCardForm>(emptyTaxCard())
  const [taxCardError, setTaxCardError] = useState('')
  const [editingTaxCardId, setEditingTaxCardId] = useState<string | null>(null)

  // Tax card from payslip (separate flow — no override, taxcard only)
  const [taxCardPayslipJobId, setTaxCardPayslipJobId] = useState<string | null>(null)
  const [taxCardPayslipData, setTaxCardPayslipData] = useState<PayslipExtraction | null>(null)

  function invalidateAfterTaxCardChange() {
    queryClient.invalidateQueries({ queryKey: qk.taxCardsAll() })
    queryClient.invalidateQueries({ queryKey: qk.salary(taxCardJobId) })
    queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
    queryClient.invalidateQueries({ queryKey: qk.allOverridesAll() })
    queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
    queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
  }

  const createTaxCardMutation = useMutation({
    mutationFn: (data: TaxCardForm) => api.post(`/jobs/${taxCardJobId}/taxcard`, buildTaxCardPayload(data)),
    onSuccess: () => {
      invalidateAfterTaxCardChange()
      setShowTaxCardForm(false); setTaxCardForm(emptyTaxCard()); setTaxCardError('')
      toast.success('Tax card saved — salary records recalculated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setTaxCardError((err.response?.data as { error?: string })?.error ?? 'Failed to save') },
  })

  const updateTaxCardMutation = useMutation({
    mutationFn: (data: TaxCardForm) => api.put(`/jobs/${taxCardJobId}/taxcard/${editingTaxCardId}`, buildTaxCardPayload(data)),
    onSuccess: () => {
      invalidateAfterTaxCardChange()
      setEditingTaxCardId(null); setShowTaxCardForm(false); setTaxCardForm(emptyTaxCard()); setTaxCardError('')
      toast.success('Tax card updated — salary records recalculated')
    },
    onError: (err) => { if (axios.isAxiosError(err)) setTaxCardError((err.response?.data as { error?: string })?.error ?? 'Failed to update') },
  })

  const taxCardFromPayslipMutation = useMutation({
    mutationFn: ({ jobId, taxCard }: { jobId: string; taxCard: TaxCardDraft }) =>
      api.post(`/jobs/${jobId}/taxcard`, taxCard),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.taxCardsAll() })
      queryClient.invalidateQueries({ queryKey: qk.salary(taxCardPayslipJobId) })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      queryClient.invalidateQueries({ queryKey: qk.allOverridesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
      queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
      setTaxCardPayslipData(null)
      setTaxCardPayslipJobId(null)
      toast.success('Tax card updated from payslip')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to save tax card')
    },
  })

  function toggleTaxCards(jobId: string) {
    setTaxCardJobId((prev) => prev === jobId ? null : jobId)
  }

  function showNewTaxCardForm() {
    setEditingTaxCardId(null); setShowTaxCardForm(true); setTaxCardForm(emptyTaxCard())
  }

  function editTaxCard(card: TaxCardSettings) {
    setEditingTaxCardId(card.id)
    setShowTaxCardForm(true)
    setTaxCardForm({
      effectiveFrom: new Date(card.effectiveFrom).toISOString().slice(0, 10),
      traekprocent: card.traekprocent,
      personfradragMonthly: card.personfradragMonthly,
      municipality: card.municipality ?? '',
      pensionEmployeePct: card.pensionEmployeePct ?? '',
      pensionEmployerPct: card.pensionEmployerPct ?? '',
      atpAmount: card.atpAmount ?? '',
      bruttoItems: card.bruttoItems?.map((b) => ({ label: b.label, monthlyAmount: String(b.monthlyAmount) })) ?? [],
    })
  }

  function hideTaxCardForm() {
    setShowTaxCardForm(false); setEditingTaxCardId(null)
  }

  function importTaxCardFromPayslip(jobId: string) {
    setTaxCardPayslipJobId(jobId)
    setTaxCardJobId(jobId)
  }

  function handleTaxCardSubmit(e: FormEvent) {
    e.preventDefault()
    if (editingTaxCardId) updateTaxCardMutation.mutate(taxCardForm)
    else createTaxCardMutation.mutate(taxCardForm)
  }

  function closeTaxCardPayslip() {
    setTaxCardPayslipData(null); setTaxCardPayslipJobId(null)
  }

  return {
    taxCardJobId, showTaxCardForm, taxCardForm, setTaxCardForm, taxCardError, editingTaxCardId,
    taxCardPayslipJobId, setTaxCardPayslipJobId, taxCardPayslipData, setTaxCardPayslipData,
    createTaxCardMutation, updateTaxCardMutation, taxCardFromPayslipMutation,
    toggleTaxCards, showNewTaxCardForm, editTaxCard, hideTaxCardForm, importTaxCardFromPayslip,
    handleTaxCardSubmit, closeTaxCardPayslip,
  }
}
export type TaxCardEditor = ReturnType<typeof useTaxCardEditor>

// ── Payslip import (as a monthly override) ────────────────────────────────────

export function usePayslipImport() {
  const queryClient = useQueryClient()
  const [payslipImportJobId, setPayslipImportJobId] = useState<string | null>(null)
  const [payslipReviewData, setPayslipReviewData] = useState<PayslipExtraction | null>(null)
  const [payslipReviewJobId, setPayslipReviewJobId] = useState<string | null>(null)

  const payslipConfirmMutation = useMutation({
    mutationFn: ({ jobId, extraction }: { jobId: string; extraction: PayslipExtraction }) =>
      api.post(`/jobs/${jobId}/overrides`, {
        year: extraction.period.year,
        month: extraction.period.month,
        grossAmount: extraction.grossSalary,
        netAmount: extraction.netPay,
        note: `Imported from payslip${extraction.employerName ? ` — ${extraction.employerName}` : ''}`,
        payslipLines: extraction.lines,
        ...(extraction.pensionEmployerMonthly ? { pensionEmployerMonthly: extraction.pensionEmployerMonthly } : {}),
        deductionsSource: 'PAYSLIP_IMPORT',
      }),
    onError: (err) => {
      if (axios.isAxiosError(err)) toast.error((err.response?.data as { error?: string })?.error ?? 'Failed to import payslip')
    },
  })

  async function handlePayslipConfirm(extraction: PayslipExtraction, taxCard?: TaxCardDraft) {
    const jobId = payslipReviewJobId!
    try {
      await payslipConfirmMutation.mutateAsync({ jobId, extraction })
      queryClient.invalidateQueries({ queryKey: qk.allOverridesAll() })
      queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })

      if (taxCard) {
        try {
          await api.post(`/jobs/${jobId}/taxcard`, taxCard)
          queryClient.invalidateQueries({ queryKey: qk.taxCardsAll() })
          queryClient.invalidateQueries({ queryKey: qk.salary(jobId) })
          queryClient.invalidateQueries({ queryKey: qk.incomeHistoryAll() })
          queryClient.invalidateQueries({ queryKey: qk.jobsAll() })
          toast.success('Payslip imported and tax card updated')
        } catch {
          toast.warning('Payslip saved, but tax card update failed')
        }
      } else {
        toast.success('Payslip imported')
      }

      setPayslipReviewData(null)
      setPayslipReviewJobId(null)
    } catch {
      // error toast handled by mutation's onError
    }
  }

  /** The import dialog produced an extraction: move on to the review dialog. */
  function reviewExtraction(data: PayslipExtraction) {
    setPayslipReviewData(data)
    setPayslipReviewJobId(payslipImportJobId)
    setPayslipImportJobId(null)
  }

  function closeReview() {
    setPayslipReviewData(null); setPayslipReviewJobId(null)
  }

  return {
    payslipImportJobId, setPayslipImportJobId, payslipReviewData, payslipReviewJobId,
    payslipConfirmMutation, handlePayslipConfirm, reviewExtraction, closeReview,
  }
}
export type PayslipImport = ReturnType<typeof usePayslipImport>
