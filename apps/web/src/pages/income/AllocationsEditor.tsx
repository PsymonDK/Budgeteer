import type { Household } from '../../api/types'
import type { Job } from './types'
import type { AllocationEditor } from './useIncomeEditors'

interface AllocationsEditorProps {
  job: Job
  households: Household[]
  allocations: AllocationEditor
  fmt: (v: number | string) => string
}

/** Per-household allocation % inputs for one job, with save/discard for pending edits. */
export function AllocationsEditor({ job, households, allocations, fmt }: AllocationsEditorProps) {
  const { allocError, allocMutation, getAllocationPct, setAllocation, hasPendingFor, saveAllocations, discardAllocations } = allocations
  return (
    <div className="border-t border-gray-800 pt-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Household allocations</p>
      <div className="space-y-2">
        {households.map((h) => {
          const pctStr = getAllocationPct(job, h.id)
          const pct = parseFloat(pctStr) || 0
          const net = job.latestSalary ? parseFloat(job.latestSalary.netAmount) * pct / 100 : 0
          return (
            <div key={h.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-300 w-44 truncate">{h.name}</span>
              <div className="flex items-center gap-2 flex-1">
                <input type="number" value={pctStr}
                  onChange={(e) => setAllocation(job.id, h.id, e.target.value)}
                  min="0" max="999" step="1"
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums" />
                <span className="text-gray-500 text-sm">%</span>
                {pct > 0 && job.latestSalary && (
                  <span className="text-gray-400 text-xs tabular-nums">= {fmt(net)} / mo net</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {(() => {
        // Whole-job total, counting saved allocations for households that weren't edited
        const totalPct = households.reduce((acc, h) => acc + (Number(getAllocationPct(job, h.id)) || 0), 0)
        const isOver = totalPct > 100
        return hasPendingFor(job.id) ? (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button onClick={() => saveAllocations(job)} disabled={allocMutation.isPending}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5 rounded transition-colors">
              {allocMutation.isPending ? 'Saving…' : 'Save allocations'}
            </button>
            <button onClick={() => discardAllocations(job.id)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Discard</button>
            {isOver && <span className="text-amber-400 text-xs">Total is {totalPct}% — more than 100% of this income is allocated</span>}
            {allocError && <span className="text-red-400 text-xs">{allocError}</span>}
          </div>
        ) : null
      })()}
    </div>
  )
}
