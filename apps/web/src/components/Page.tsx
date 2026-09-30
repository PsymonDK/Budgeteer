import type { ReactNode } from 'react'

/**
 * Page templates (see docs/architecture.md → App shell and breakpoints):
 * - `dashboard`, `list`, `analysis`: use the full width the shell gives them
 * - `form`: keeps a readable width (56rem), centred
 */
export type PageTemplate = 'dashboard' | 'list' | 'form' | 'analysis'

const WIDTH: Record<PageTemplate, string> = {
  dashboard: 'w-full',
  list: 'w-full',
  analysis: 'w-full',
  form: 'w-full max-w-4xl mx-auto',
}

/** Gutters grow with the size classes: 16 → 24 → 28 (1440+) → 36 (2200+). */
const GUTTER = 'px-4 sm:px-6 wide:px-7 ultra:px-9 py-6 sm:py-8'

/** Outer element of every page rendered inside the AppShell. Sets width and gutters by template. */
export function Page({ template, className = '', children }: { template: PageTemplate; className?: string; children: ReactNode }) {
  return <main className={`${WIDTH[template]} ${GUTTER} ${className}`}>{children}</main>
}
