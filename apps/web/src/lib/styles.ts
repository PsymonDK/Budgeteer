export const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors'

// ── Buttons ───────────────────────────────────────────────────────────────────

/** Full-size primary action (modal submit). Prefix with `flex-1` in a two-button row. */
export const primaryBtn =
  'bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors'

/** Full-size secondary action (modal cancel). */
export const secondaryBtn =
  'bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg px-4 py-2.5 text-sm transition-colors'

/** Full-size destructive action (delete confirm). */
export const dangerBtn =
  'bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors'

/** Compact primary button for page headers ("+ New …"). */
export const primaryBtnSm =
  'bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors'

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Inline error box under a form. */
export const errorBox = 'bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm'

/** Compact inline error box (confirm dialogs). */
export const errorBoxSm = 'bg-red-950 border border-red-800 text-red-300 px-3 py-2 rounded-lg text-xs'

// ── Segmented toggles ─────────────────────────────────────────────────────────

/** Wrapper of a segmented toggle (e.g. Monthly | Annual). */
export const segmentGroup = 'flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium'

/** Wrapper of a segmented toggle whose buttons use `segmentBtnSolid`. */
export const segmentGroupPlain = 'flex rounded-lg overflow-hidden border border-gray-700 text-xs'

/** One segment of a `segmentGroup` toggle. */
export function segmentBtn(active: boolean): string {
  return `px-3 py-1.5 transition-colors ${active ? 'bg-amber-400 text-gray-950' : 'text-gray-400 hover:text-white'}`
}

/** One segment with a filled inactive state and bold active label. */
export function segmentBtnSolid(active: boolean): string {
  return `px-3 py-1.5 transition-colors ${active ? 'bg-amber-400 text-gray-950 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`
}
