import { useSyncExternalStore } from 'react'

/**
 * Installing Budgeteer as an app (see public/manifest.webmanifest).
 *
 * Chrome and Edge fire `beforeinstallprompt` when the app can be installed and isn't yet; we keep the
 * event so our own "Install app" button can open the browser's install dialog. Safari (iOS) has no
 * such event, so iPhone and iPad users get the Share → Add to Home Screen steps instead.
 * Imported by main.tsx so the listener is in place before the event fires.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const HINT_DISMISSED_KEY = 'budgeteer.installHintDismissed'

let deferred: BeforeInstallPromptEvent | null = null
let justInstalled = false
let hintDismissed = readHintDismissed()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function readHintDismissed() {
  try { return localStorage.getItem(HINT_DISMISSED_KEY) === '1' } catch { return false }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Our own button offers it instead of Chrome's mini-infobar
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    justInstalled = true
    notify()
  })
}

/** Running as the installed app (home screen / app window) rather than in a browser tab. */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos() {
  // iPadOS reports itself as a Mac, but with touch
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export interface InstallState {
  /** Running as the installed app, or installed during this visit. */
  installed: boolean
  /** The browser's install dialog can be opened with `promptInstall`. */
  canPrompt: boolean
  /** iPhone / iPad in the browser: installing is done by hand via Share → Add to Home Screen. */
  showIosSteps: boolean
  /** The phone hint was dismissed on this device. */
  hintDismissed: boolean
}

let snapshot: InstallState | null = null

function getSnapshot(): InstallState {
  const installed = justInstalled || isStandalone()
  const next: InstallState = {
    installed,
    canPrompt: !installed && deferred !== null,
    showIosSteps: !installed && isIos(),
    hintDismissed,
  }
  // useSyncExternalStore needs the same object while nothing changed
  if (!snapshot || Object.keys(next).some((k) => next[k as keyof InstallState] !== snapshot![k as keyof InstallState])) {
    snapshot = next
  }
  return snapshot
}

const SERVER_SNAPSHOT: InstallState = { installed: false, canPrompt: false, showIosSteps: false, hintDismissed: true }

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  const mql = window.matchMedia('(display-mode: standalone)')
  mql.addEventListener('change', onChange)
  return () => {
    listeners.delete(onChange)
    mql.removeEventListener('change', onChange)
  }
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}

/** Opens the browser's install dialog. The saved event can only be used once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  notify()
  await event.prompt()
  const { outcome } = await event.userChoice
  return outcome
}

export function dismissInstallHint() {
  hintDismissed = true
  try { localStorage.setItem(HINT_DISMISSED_KEY, '1') } catch { /* preference only */ }
  notify()
}
