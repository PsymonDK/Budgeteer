// Shared class strings for form controls and buttons (Chart & Ledger component sheet).
// Brass is for the primary action only; toggles and secondary actions use the sea neutrals.

/** Keyboard focus ring shared by buttons and toggles. */
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900'

export const inputClass =
  'w-full bg-gray-950/60 border border-gray-700 rounded-md px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400/60 disabled:opacity-60 transition-colors'

// ── Buttons ───────────────────────────────────────────────────────────────────

/** Full-size primary action (modal submit). Prefix with `flex-1` in a two-button row. */
export const primaryBtn =
  `bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-semibold rounded-md px-4 py-2.5 text-sm transition-colors ${focusRing}`

/** Full-size secondary action (modal cancel): outlined, no fill. */
export const secondaryBtn =
  `border border-gray-700 hover:border-gray-600 hover:bg-gray-800/60 text-gray-200 rounded-md px-4 py-2.5 text-sm transition-colors ${focusRing}`

/** Full-size destructive action (delete confirm): port-red outline with a faint fill. */
export const dangerBtn =
  `border border-red-500/60 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-red-200 font-semibold rounded-md px-4 py-2.5 text-sm transition-colors ${focusRing}`

/** Compact primary button for page headers ("+ New …"). */
export const primaryBtnSm =
  `bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-3.5 py-2 rounded-md transition-colors ${focusRing}`

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Error box under a form. */
export const errorBox = 'bg-red-950/60 border border-red-800/70 text-red-200 px-4 py-3 rounded-md text-sm'

/** Compact error box (confirm dialogs). */
export const errorBoxSm = 'bg-red-950/60 border border-red-800/70 text-red-200 px-3 py-2 rounded-md text-xs'

// ── Segmented toggles ─────────────────────────────────────────────────────────
// An inset track with the active option raised; brass stays reserved for primary actions.

/** Wrapper of a segmented toggle (e.g. Monthly | Annual). */
export const segmentGroup = 'inline-flex gap-0.5 rounded-md bg-gray-950/60 border border-gray-800 p-0.5 text-xs font-medium'

/** Wrapper of a segmented toggle whose buttons use `segmentBtnSolid`. */
export const segmentGroupPlain = 'inline-flex gap-0.5 rounded-md bg-gray-950/60 border border-gray-800 p-0.5 text-xs'

/** One segment of a `segmentGroup` toggle. */
export function segmentBtn(active: boolean): string {
  return `px-3 py-1 rounded transition-colors ${focusRing} ${active ? 'bg-gray-800 text-gray-100 shadow-sm shadow-black/30' : 'text-gray-400 hover:text-gray-200'}`
}

/** One segment with a bold active label. */
export function segmentBtnSolid(active: boolean): string {
  return `px-3 py-1 rounded transition-colors ${focusRing} ${active ? 'bg-gray-800 text-gray-100 font-semibold shadow-sm shadow-black/30' : 'text-gray-400 hover:text-gray-200'}`
}
