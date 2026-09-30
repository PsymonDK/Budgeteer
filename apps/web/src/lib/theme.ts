import { useSyncExternalStore } from 'react'

/**
 * Appearance: follow the system, or force Day chart (light) / Night watch (dark).
 * Stored per browser (a display preference, like the collapsed sidebar). index.html applies the stored
 * value before the first paint; index.css reads `data-theme` on <html> ("system" = no attribute).
 */
export type ThemePreference = 'system' | 'light' | 'dark'

const KEY = 'budgeteer.theme'
const listeners = new Set<() => void>()

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch { /* preference only */ }
  apply(pref)
  listeners.forEach((l) => l())
}

export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const pref = useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => { listeners.delete(onChange) } },
    readThemePreference,
    () => 'system' as ThemePreference,
  )
  return [pref, setThemePreference]
}
