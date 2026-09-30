// Display helpers for budget years (labels and status badge colours).

/** Badge colour for a retired year (or any unknown status). */
export const RETIRED_STATUS_CLASS = 'bg-transparent text-gray-400 ring-1 ring-inset ring-gray-700'
/** Dimmer retired badge used in the budget-year and history lists. */
export const RETIRED_STATUS_CLASS_MUTED = 'bg-transparent text-gray-500 ring-1 ring-inset ring-gray-800'

/** Tailwind colour classes for a budget-year status badge. */
export function budgetYearStatusClass(status: string, retiredClass: string = RETIRED_STATUS_CLASS): string {
  if (status === 'ACTIVE') return 'bg-green-500/10 text-green-300'
  if (status === 'FUTURE') return 'bg-gray-800/70 text-gray-300'
  if (status === 'SIMULATION') return 'bg-purple-500/10 text-purple-200'
  return retiredClass
}

/**
 * Shape marker per status, so the badge reads without colour: filled dot (active), ring (future),
 * diamond (simulation), square (retired).
 */
export function budgetYearStatusMarker(status: string): string {
  if (status === 'ACTIVE') return 'rounded-full bg-current'
  if (status === 'FUTURE') return 'rounded-full ring-[1.5px] ring-inset ring-current'
  if (status === 'SIMULATION') return 'rotate-45 rounded-[1px] bg-current'
  return 'rounded-[1px] bg-current opacity-70'
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
