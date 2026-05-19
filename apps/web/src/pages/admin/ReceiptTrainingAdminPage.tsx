import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { inputClass, primaryBtn, secondaryBtn } from '../../lib/styles'

type Tab = 'terms' | 'mappings' | 'subcategories'
type Scope = 'system' | 'household'
type TermType = 'NOISE_TOKEN' | 'LOW_VALUE_WORD' | 'OCR_ALIAS'

interface HouseholdOption {
  id: string
  name: string
  isActive: boolean
}

interface CategoryOption {
  id: string
  name: string
  isSystemWide: boolean
  isActive: boolean
  householdId: string | null
}

interface TrainingTerm {
  id: string
  scope: Scope
  householdId: string | null
  householdName: string | null
  termType: TermType
  term: string
  isActive: boolean
  source: string
  hitCount: number
}

interface TrainingSubcategory {
  id: string
  categoryId: string
  categoryName: string
  householdId: string | null
  householdName: string | null
  name: string
  isSystemWide: boolean
  isActive: boolean
  lineItemCount: number
  mappingCount: number
}

interface TrainingMapping {
  id: string
  scope: Scope
  scopeKey: string
  householdId: string | null
  householdName: string | null
  normalizedLabel: string
  merchantKey: string
  categoryId: string
  categoryName: string
  subcategoryId: string | null
  subcategoryName: string | null
  confidence: number
  hitCount: number
}

interface ReceiptTrainingSnapshot {
  households: HouseholdOption[]
  categories: CategoryOption[]
  terms: TrainingTerm[]
  subcategories: TrainingSubcategory[]
  mappings: TrainingMapping[]
}

const emptyTerm = { scope: 'system' as Scope, householdId: '', termType: 'OCR_ALIAS' as TermType, term: '', isActive: true }
const emptySubcategory = { scope: 'system' as Scope, householdId: '', categoryId: '', name: '', isActive: true }
const emptyMapping = { scope: 'system' as Scope, householdId: '', merchantKey: '', normalizedLabel: '', categoryId: '', subcategoryId: '', confidence: '1' }

export function ReceiptTrainingAdminPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('terms')
  const [search, setSearch] = useState('')
  const [termDraft, setTermDraft] = useState(emptyTerm)
  const [subcategoryDraft, setSubcategoryDraft] = useState(emptySubcategory)
  const [mappingDraft, setMappingDraft] = useState(emptyMapping)
  const [editTerm, setEditTerm] = useState<TrainingTerm | null>(null)
  const [editSubcategory, setEditSubcategory] = useState<TrainingSubcategory | null>(null)
  const [editMapping, setEditMapping] = useState<TrainingMapping | null>(null)

  const { data, isLoading } = useQuery<ReceiptTrainingSnapshot>({
    queryKey: ['admin', 'receipt-training'],
    queryFn: async () => (await api.get<ReceiptTrainingSnapshot>('/admin/receipt-training')).data,
  })

  const snapshot = data ?? { households: [], categories: [], terms: [], subcategories: [], mappings: [] }
  const activeHouseholds = snapshot.households.filter((household) => household.isActive)
  const activeCategories = snapshot.categories.filter((category) => category.isActive)
  const query = search.trim().toLowerCase()

  const filteredTerms = useMemo(() => snapshot.terms.filter((term) =>
    !query || [term.term, term.termType, term.householdName ?? 'system', term.source].some((value) => value.toLowerCase().includes(query)),
  ), [snapshot.terms, query])

  const filteredSubcategories = useMemo(() => snapshot.subcategories.filter((subcategory) =>
    !query || [subcategory.name, subcategory.categoryName, subcategory.householdName ?? 'system'].some((value) => value.toLowerCase().includes(query)),
  ), [snapshot.subcategories, query])

  const filteredMappings = useMemo(() => snapshot.mappings.filter((mapping) =>
    !query || [mapping.normalizedLabel, mapping.merchantKey, mapping.householdName ?? 'system', mapping.categoryName, mapping.subcategoryName ?? ''].some((value) => value.toLowerCase().includes(query)),
  ), [snapshot.mappings, query])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'receipt-training'] })
  const createTermMutation = useMutation({
    mutationFn: () => api.post('/admin/receipt-training/terms', termBody(termDraft)),
    onSuccess: () => { invalidate(); setTermDraft(emptyTerm); toast.success('Classifier term saved') },
    onError: (err) => toast.error(readError(err, 'Failed to save classifier term')),
  })
  const updateTermMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TrainingTerm> }) => api.patch(`/admin/receipt-training/terms/${id}`, body),
    onSuccess: () => { invalidate(); setEditTerm(null); toast.success('Classifier term updated') },
    onError: (err) => toast.error(readError(err, 'Failed to update classifier term')),
  })
  const deleteTermMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/receipt-training/terms/${id}`),
    onSuccess: () => { invalidate(); toast.success('Classifier term deleted') },
    onError: (err) => toast.error(readError(err, 'Failed to delete classifier term')),
  })

  const createSubcategoryMutation = useMutation({
    mutationFn: () => api.post('/admin/receipt-training/subcategories', scopedBody(subcategoryDraft)),
    onSuccess: () => { invalidate(); setSubcategoryDraft(emptySubcategory); toast.success('Receipt subcategory saved') },
    onError: (err) => toast.error(readError(err, 'Failed to save receipt subcategory')),
  })
  const updateSubcategoryMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TrainingSubcategory> }) => api.patch(`/admin/receipt-training/subcategories/${id}`, body),
    onSuccess: () => { invalidate(); setEditSubcategory(null); toast.success('Receipt subcategory updated') },
    onError: (err) => toast.error(readError(err, 'Failed to update receipt subcategory')),
  })

  const createMappingMutation = useMutation({
    mutationFn: () => api.post('/admin/receipt-training/mappings', mappingBody(mappingDraft)),
    onSuccess: () => { invalidate(); setMappingDraft(emptyMapping); toast.success('Receipt mapping saved') },
    onError: (err) => toast.error(readError(err, 'Failed to save receipt mapping')),
  })
  const updateMappingMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TrainingMapping> & { confidence?: number } }) => api.patch(`/admin/receipt-training/mappings/${id}`, body),
    onSuccess: () => { invalidate(); setEditMapping(null); toast.success('Receipt mapping updated') },
    onError: (err) => toast.error(readError(err, 'Failed to update receipt mapping')),
  })
  const deleteMappingMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/receipt-training/mappings/${id}`),
    onSuccess: () => { invalidate(); toast.success('Receipt mapping deleted') },
    onError: (err) => toast.error(readError(err, 'Failed to delete receipt mapping')),
  })

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 w-full">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Receipt training</h1>
          <p className="text-sm text-gray-500 mt-1">Maintain system receipt vocabulary, category mappings, and subcategories.</p>
        </div>
        <label className="w-full lg:w-80">
          <span className="sr-only">Search receipt training data</span>
          <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search training data" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <TabButton active={tab === 'terms'} onClick={() => setTab('terms')}>Classifier terms ({snapshot.terms.length})</TabButton>
        <TabButton active={tab === 'mappings'} onClick={() => setTab('mappings')}>Learned mappings ({snapshot.mappings.length})</TabButton>
        <TabButton active={tab === 'subcategories'} onClick={() => setTab('subcategories')}>Receipt subcategories ({snapshot.subcategories.length})</TabButton>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : tab === 'terms' ? (
        <>
          <TermCreateForm draft={termDraft} setDraft={setTermDraft} households={activeHouseholds} onSubmit={() => createTermMutation.mutate()} isPending={createTermMutation.isPending} />
          <TermsTable terms={filteredTerms} onEdit={setEditTerm} onToggle={(term) => updateTermMutation.mutate({ id: term.id, body: { isActive: !term.isActive } })} onDelete={(id) => deleteTermMutation.mutate(id)} />
        </>
      ) : tab === 'mappings' ? (
        <>
          <MappingCreateForm draft={mappingDraft} setDraft={setMappingDraft} households={activeHouseholds} categories={activeCategories} subcategories={snapshot.subcategories} onSubmit={() => createMappingMutation.mutate()} isPending={createMappingMutation.isPending} />
          <MappingsTable mappings={filteredMappings} onEdit={setEditMapping} onDelete={(id) => deleteMappingMutation.mutate(id)} />
        </>
      ) : (
        <>
          <SubcategoryCreateForm draft={subcategoryDraft} setDraft={setSubcategoryDraft} households={activeHouseholds} categories={activeCategories} onSubmit={() => createSubcategoryMutation.mutate()} isPending={createSubcategoryMutation.isPending} />
          <SubcategoriesTable subcategories={filteredSubcategories} onEdit={setEditSubcategory} onToggle={(subcategory) => updateSubcategoryMutation.mutate({ id: subcategory.id, body: { isActive: !subcategory.isActive } })} />
        </>
      )}

      {editTerm && (
        <EditTermModal
          term={editTerm}
          onClose={() => setEditTerm(null)}
          onSave={(body) => updateTermMutation.mutate({ id: editTerm.id, body })}
          isPending={updateTermMutation.isPending}
        />
      )}
      {editSubcategory && (
        <EditSubcategoryModal
          subcategory={editSubcategory}
          onClose={() => setEditSubcategory(null)}
          onSave={(body) => updateSubcategoryMutation.mutate({ id: editSubcategory.id, body })}
          isPending={updateSubcategoryMutation.isPending}
        />
      )}
      {editMapping && (
        <EditMappingModal
          mapping={editMapping}
          categories={activeCategories.filter((category) => category.isSystemWide || category.householdId === editMapping.householdId)}
          subcategories={snapshot.subcategories.filter((subcategory) => subcategory.isSystemWide || subcategory.householdId === editMapping.householdId)}
          onClose={() => setEditMapping(null)}
          onSave={(body) => updateMappingMutation.mutate({ id: editMapping.id, body })}
          isPending={updateMappingMutation.isPending}
        />
      )}
    </main>
  )
}

function TermCreateForm({ draft, setDraft, households, onSubmit, isPending }: {
  draft: typeof emptyTerm
  setDraft: (draft: typeof emptyTerm) => void
  households: HouseholdOption[]
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <ScopeFields scope={draft.scope} householdId={draft.householdId} households={households} onChange={(scope, householdId) => setDraft({ ...draft, scope, householdId })} />
      <label>
        <span className="block text-xs text-gray-400 mb-1">Type</span>
        <select className={inputClass} value={draft.termType} onChange={(e) => setDraft({ ...draft, termType: e.target.value as TermType })}>
          <option value="OCR_ALIAS">OCR alias</option>
          <option value="NOISE_TOKEN">Noise token</option>
          <option value="LOW_VALUE_WORD">Low-value word</option>
        </select>
      </label>
      <label className="md:col-span-2">
        <span className="block text-xs text-gray-400 mb-1">Term</span>
        <input className={inputClass} value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder="totlet=>toilet" required />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-300 pb-2">
        <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
        Active
      </label>
      <button className={`${primaryBtn} flex items-center justify-center gap-2`} disabled={isPending || (draft.scope === 'household' && !draft.householdId)}>
        <Plus size={16} /> Add term
      </button>
    </form>
  )
}

function MappingCreateForm({ draft, setDraft, households, categories, subcategories, onSubmit, isPending }: {
  draft: typeof emptyMapping
  setDraft: (draft: typeof emptyMapping) => void
  households: HouseholdOption[]
  categories: CategoryOption[]
  subcategories: TrainingSubcategory[]
  onSubmit: () => void
  isPending: boolean
}) {
  const visibleCategories = categories.filter((category) => draft.scope === 'system' ? category.isSystemWide : category.isSystemWide || category.householdId === draft.householdId)
  const visibleSubcategories = subcategories.filter((subcategory) =>
    subcategory.isActive && subcategory.categoryId === draft.categoryId && (draft.scope === 'system' ? subcategory.isSystemWide : subcategory.isSystemWide || subcategory.householdId === draft.householdId),
  )
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <ScopeFields scope={draft.scope} householdId={draft.householdId} households={households} onChange={(scope, householdId) => setDraft({ ...draft, scope, householdId, categoryId: '', subcategoryId: '' })} />
      <label>
        <span className="block text-xs text-gray-400 mb-1">Merchant key</span>
        <input className={inputClass} value={draft.merchantKey} onChange={(e) => setDraft({ ...draft, merchantKey: e.target.value })} placeholder="any merchant" />
      </label>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Normalized label</span>
        <input className={inputClass} value={draft.normalizedLabel} onChange={(e) => setDraft({ ...draft, normalizedLabel: e.target.value })} placeholder="organic milk" required />
      </label>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Category</span>
        <select className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value, subcategoryId: '' })} required disabled={draft.scope === 'household' && !draft.householdId}>
          <option value="">Select category</option>
          {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Subcategory</span>
        <select className={inputClass} value={draft.subcategoryId} onChange={(e) => setDraft({ ...draft, subcategoryId: e.target.value })} disabled={!draft.categoryId}>
          <option value="">No subcategory</option>
          {visibleSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Confidence</span>
        <input type="number" min="0" max="1" step="0.01" className={inputClass} value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value })} />
      </label>
      <button className={`${primaryBtn} flex items-center justify-center gap-2 md:col-span-5`} disabled={isPending || (draft.scope === 'household' && !draft.householdId)}>
        <Plus size={16} /> Add mapping
      </button>
    </form>
  )
}

function SubcategoryCreateForm({ draft, setDraft, households, categories, onSubmit, isPending }: {
  draft: typeof emptySubcategory
  setDraft: (draft: typeof emptySubcategory) => void
  households: HouseholdOption[]
  categories: CategoryOption[]
  onSubmit: () => void
  isPending: boolean
}) {
  const visibleCategories = categories.filter((category) => draft.scope === 'system' ? category.isSystemWide : category.isSystemWide || category.householdId === draft.householdId)
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <ScopeFields scope={draft.scope} householdId={draft.householdId} households={households} onChange={(scope, householdId) => setDraft({ ...draft, scope, householdId, categoryId: '' })} />
      <label className="md:col-span-2">
        <span className="block text-xs text-gray-400 mb-1">Category</span>
        <select className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })} required disabled={draft.scope === 'household' && !draft.householdId}>
          <option value="">Select category</option>
          {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label className="md:col-span-2">
        <span className="block text-xs text-gray-400 mb-1">Name</span>
        <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Paper goods" required />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-300 pb-2">
        <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
        Active
      </label>
      <button className={`${primaryBtn} flex items-center justify-center gap-2`} disabled={isPending || (draft.scope === 'household' && !draft.householdId)}>
        <Plus size={16} /> Add subcategory
      </button>
    </form>
  )
}

function ScopeFields({ scope, householdId, households, onChange }: {
  scope: Scope
  householdId: string
  households: HouseholdOption[]
  onChange: (scope: Scope, householdId: string) => void
}) {
  return (
    <>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Scope</span>
        <select className={inputClass} value={scope} onChange={(e) => onChange(e.target.value as Scope, '')}>
          <option value="system">System</option>
          <option value="household">Household</option>
        </select>
      </label>
      <label>
        <span className="block text-xs text-gray-400 mb-1">Household</span>
        <select className={inputClass} value={householdId} onChange={(e) => onChange(scope, e.target.value)} disabled={scope === 'system'} required={scope === 'household'}>
          <option value="">All households</option>
          {households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
        </select>
      </label>
    </>
  )
}

function TermsTable({ terms, onEdit, onToggle, onDelete }: {
  terms: TrainingTerm[]
  onEdit: (term: TrainingTerm) => void
  onToggle: (term: TrainingTerm) => void
  onDelete: (id: string) => void
}) {
  return (
    <AdminTable>
      <TableHeader columns="xl:grid-cols-[120px_130px_minmax(180px,1fr)_120px_88px_104px]" labels={['Scope', 'Type', 'Term', 'Source', 'Status', 'Actions']} />
      {terms.map((term) => (
        <div key={term.id} className="grid grid-cols-1 xl:grid-cols-[120px_130px_minmax(180px,1fr)_120px_88px_104px] gap-2 px-4 py-3 border-b border-gray-800 last:border-0 text-sm">
          <span className="text-gray-300">{term.householdName ?? 'System'}</span>
          <span className="text-gray-400">{term.termType}</span>
          <span className="font-mono text-gray-100 truncate" title={term.term}>{term.term}</span>
          <span className="text-gray-500">{term.source}</span>
          <button type="button" onClick={() => onToggle(term)} className={statusClass(term.isActive)}>{term.isActive ? 'Active' : 'Inactive'}</button>
          <RowActions onEdit={() => onEdit(term)} onDelete={() => onDelete(term.id)} />
        </div>
      ))}
    </AdminTable>
  )
}

function MappingsTable({ mappings, onEdit, onDelete }: {
  mappings: TrainingMapping[]
  onEdit: (mapping: TrainingMapping) => void
  onDelete: (id: string) => void
}) {
  return (
    <AdminTable>
      <TableHeader columns="xl:grid-cols-[150px_minmax(180px,1.2fr)_130px_minmax(160px,1fr)_88px_80px_104px]" labels={['Scope', 'Label', 'Merchant', 'Category', 'Confidence', 'Hits', 'Actions']} />
      {mappings.map((mapping) => (
        <div key={mapping.id} className="grid grid-cols-1 xl:grid-cols-[150px_minmax(180px,1.2fr)_130px_minmax(160px,1fr)_88px_80px_104px] gap-2 px-4 py-3 border-b border-gray-800 last:border-0 text-sm">
          <span className="text-gray-300">{mapping.householdName ?? 'System'}</span>
          <span className="font-mono text-gray-100 truncate" title={mapping.normalizedLabel}>{mapping.normalizedLabel}</span>
          <span className="text-gray-400 truncate">{mapping.merchantKey || 'Any'}</span>
          <span className="text-gray-300 truncate">{mapping.categoryName}{mapping.subcategoryName ? ` / ${mapping.subcategoryName}` : ''}</span>
          <span className="text-gray-400">{mapping.confidence.toFixed(2)}</span>
          <span className="text-gray-500">{mapping.hitCount}</span>
          <RowActions onEdit={() => onEdit(mapping)} onDelete={() => onDelete(mapping.id)} />
        </div>
      ))}
    </AdminTable>
  )
}

function SubcategoriesTable({ subcategories, onEdit, onToggle }: {
  subcategories: TrainingSubcategory[]
  onEdit: (subcategory: TrainingSubcategory) => void
  onToggle: (subcategory: TrainingSubcategory) => void
}) {
  return (
    <AdminTable>
      <TableHeader columns="xl:grid-cols-[150px_minmax(160px,1fr)_150px_96px_96px_88px_72px]" labels={['Scope', 'Name', 'Category', 'Lines', 'Mappings', 'Status', 'Actions']} />
      {subcategories.map((subcategory) => (
        <div key={subcategory.id} className="grid grid-cols-1 xl:grid-cols-[150px_minmax(160px,1fr)_150px_96px_96px_88px_72px] gap-2 px-4 py-3 border-b border-gray-800 last:border-0 text-sm">
          <span className="text-gray-300">{subcategory.householdName ?? 'System'}</span>
          <span className="text-gray-100 truncate">{subcategory.name}</span>
          <span className="text-gray-400 truncate">{subcategory.categoryName}</span>
          <span className="text-gray-500">{subcategory.lineItemCount}</span>
          <span className="text-gray-500">{subcategory.mappingCount}</span>
          <button type="button" onClick={() => onToggle(subcategory)} className={statusClass(subcategory.isActive)}>{subcategory.isActive ? 'Active' : 'Inactive'}</button>
          <button type="button" onClick={() => onEdit(subcategory)} className="text-gray-400 hover:text-white justify-self-start" aria-label="Edit subcategory"><Pencil size={16} /></button>
        </div>
      ))}
    </AdminTable>
  )
}

function EditTermModal({ term, onClose, onSave, isPending }: {
  term: TrainingTerm
  onClose: () => void
  onSave: (body: { termType: TermType; term: string; isActive: boolean; source: string }) => void
  isPending: boolean
}) {
  const [termType, setTermType] = useState<TermType>(term.termType)
  const [value, setValue] = useState(term.term)
  const [source, setSource] = useState(term.source)
  const [isActive, setIsActive] = useState(term.isActive)
  return (
    <Modal title="Edit classifier term" size="sm" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ termType, term: value, isActive, source }) }} className="space-y-4">
        <label><span className="block text-sm text-gray-400 mb-1">Type</span><select className={inputClass} value={termType} onChange={(e) => setTermType(e.target.value as TermType)}><option value="OCR_ALIAS">OCR alias</option><option value="NOISE_TOKEN">Noise token</option><option value="LOW_VALUE_WORD">Low-value word</option></select></label>
        <label><span className="block text-sm text-gray-400 mb-1">Term</span><input className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} required /></label>
        <label><span className="block text-sm text-gray-400 mb-1">Source</span><input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Active</label>
        <ModalActions onClose={onClose} isPending={isPending} />
      </form>
    </Modal>
  )
}

function EditSubcategoryModal({ subcategory, onClose, onSave, isPending }: {
  subcategory: TrainingSubcategory
  onClose: () => void
  onSave: (body: { name: string; isActive: boolean }) => void
  isPending: boolean
}) {
  const [name, setName] = useState(subcategory.name)
  const [isActive, setIsActive] = useState(subcategory.isActive)
  return (
    <Modal title="Edit receipt subcategory" size="sm" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ name, isActive }) }} className="space-y-4">
        <label><span className="block text-sm text-gray-400 mb-1">Name</span><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Active</label>
        <ModalActions onClose={onClose} isPending={isPending} />
      </form>
    </Modal>
  )
}

function EditMappingModal({ mapping, categories, subcategories, onClose, onSave, isPending }: {
  mapping: TrainingMapping
  categories: CategoryOption[]
  subcategories: TrainingSubcategory[]
  onClose: () => void
  onSave: (body: { merchantKey: string; normalizedLabel: string; categoryId: string; subcategoryId: string | null; confidence: number }) => void
  isPending: boolean
}) {
  const [merchantKey, setMerchantKey] = useState(mapping.merchantKey)
  const [normalizedLabel, setNormalizedLabel] = useState(mapping.normalizedLabel)
  const [categoryId, setCategoryId] = useState(mapping.categoryId)
  const [subcategoryId, setSubcategoryId] = useState(mapping.subcategoryId ?? '')
  const [confidence, setConfidence] = useState(String(mapping.confidence))
  const visibleCategories = categories.filter((category) => mapping.scope === 'system' ? category.isSystemWide : category.isSystemWide || category.householdId === mapping.householdId)
  const visibleSubcategories = subcategories.filter((subcategory) =>
    subcategory.isActive && subcategory.categoryId === categoryId && (mapping.scope === 'system' ? subcategory.isSystemWide : subcategory.isSystemWide || subcategory.householdId === mapping.householdId),
  )
  return (
    <Modal title="Edit receipt mapping" size="md" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ merchantKey, normalizedLabel, categoryId, subcategoryId: subcategoryId || null, confidence: Number(confidence) }) }} className="space-y-4">
        <p className="text-sm text-gray-400">Scope: {mapping.householdName ?? 'System'}</p>
        <label><span className="block text-sm text-gray-400 mb-1">Normalized label</span><input className={inputClass} value={normalizedLabel} onChange={(e) => setNormalizedLabel(e.target.value)} required /></label>
        <label><span className="block text-sm text-gray-400 mb-1">Merchant key</span><input className={inputClass} value={merchantKey} onChange={(e) => setMerchantKey(e.target.value)} /></label>
        <label><span className="block text-sm text-gray-400 mb-1">Category</span><select className={inputClass} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId('') }} required>{visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span className="block text-sm text-gray-400 mb-1">Subcategory</span><select className={inputClass} value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}><option value="">No subcategory</option>{visibleSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}</select></label>
        <label><span className="block text-sm text-gray-400 mb-1">Confidence</span><input type="number" min="0" max="1" step="0.01" className={inputClass} value={confidence} onChange={(e) => setConfidence(e.target.value)} /></label>
        <ModalActions onClose={onClose} isPending={isPending} />
      </form>
    </Modal>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}>{children}</button>
}

function AdminTable({ children }: { children: ReactNode }) {
  return <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">{children}</div>
}

function TableHeader({ labels, columns }: { labels: string[]; columns: string }) {
  return <div className={`hidden xl:grid ${columns} gap-2 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-400`}>{labels.map((label) => <span key={label}>{label}</span>)}</div>
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onEdit} className="text-gray-400 hover:text-white" aria-label="Edit"><Pencil size={16} /></button>
      <button type="button" onClick={onDelete} className="text-red-300 hover:text-red-200" aria-label="Delete"><Trash2 size={16} /></button>
    </div>
  )
}

function ModalActions({ onClose, isPending }: { onClose: () => void; isPending: boolean }) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
      <button type="submit" disabled={isPending} className={primaryBtn}>{isPending ? 'Saving...' : 'Save'}</button>
    </div>
  )
}

function statusClass(isActive: boolean) {
  return `w-fit text-xs rounded-full px-2 py-0.5 ${isActive ? 'bg-emerald-900/50 text-emerald-300' : 'bg-gray-800 text-gray-500'}`
}

function termBody(draft: typeof emptyTerm) {
  return { ...scopedBody(draft), termType: draft.termType, term: draft.term, isActive: draft.isActive, source: 'ADMIN' }
}

function scopedBody(draft: { scope: Scope; householdId: string; [key: string]: unknown }) {
  const { scope, householdId, ...rest } = draft
  return scope === 'system' ? { scope, ...rest } : { scope, householdId, ...rest }
}

function mappingBody(draft: typeof emptyMapping) {
  return {
    scope: draft.scope,
    ...(draft.scope === 'household' && { householdId: draft.householdId }),
    merchantKey: draft.merchantKey.trim(),
    normalizedLabel: draft.normalizedLabel.trim(),
    categoryId: draft.categoryId,
    subcategoryId: draft.subcategoryId || null,
    confidence: Number(draft.confidence || 1),
  }
}

function readError(err: unknown, fallback: string): string {
  const maybe = err as { response?: { data?: { error?: string } } }
  return maybe.response?.data?.error ?? fallback
}
