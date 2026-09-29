// Display helpers for budget years (labels and status badge colours).

/** Badge colour for a retired year (or any unknown status). */
export const RETIRED_STATUS_CLASS = 'bg-gray-800 text-gray-400'
/** Dimmer retired badge used in the budget-year and history lists. */
export const RETIRED_STATUS_CLASS_MUTED = 'bg-gray-800 text-gray-500'

/** Tailwind colour classes for a budget-year status badge. */
export function budgetYearStatusClass(status: string, retiredClass: string = RETIRED_STATUS_CLASS): string {
  if (status === 'ACTIVE') return 'bg-green-900/50 text-green-300'
  if (status === 'FUTURE') return 'bg-blue-900/50 text-blue-300'
  if (status === 'SIMULATION') return 'bg-purple-900/50 text-purple-300'
  return retiredClass
}

/** "ACTIVE" → "Active". */
export function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

/** "2025 (Active)", or "2025 — No car" for a simulation. */
export function yearLabel(y: { year: number; status: string; simulationName: string | null }): string {
  if (y.status === 'SIMULATION') return `${y.year} — ${y.simulationName ?? 'Simulation'}`
  return `${y.year} (${statusLabel(y.status)})`
}
