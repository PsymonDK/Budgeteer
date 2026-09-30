import type { ReactNode } from 'react'

const VARIANT = {
  // Inside a Modal (the dialog is the scroll container): pinned to its bottom edge at every size.
  // Sticky stops at the dialog's padding, so the negative `bottom` and margins (equal to that padding)
  // put the bar on the very edge; the margins are `!important` because forms use `space-y-*`,
  // which resets sibling margins.
  dialog:
    'sticky -bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:-bottom-6 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 !mt-4 ' +
    '!-mb-[calc(1rem+env(safe-area-inset-bottom))] sm:!-mb-6 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-6 ' +
    'bg-gray-900 border-t border-gray-800',
  // On a page: pinned above the phone tab bar (the shell's scroll area already reserves the tab bar's
  // height as padding, and sticky stops at that padding); from 640px it sits in the flow like before.
  page:
    'sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-gray-950/95 backdrop-blur border-t border-gray-800 ' +
    'sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0',
}

/**
 * A form's Save / Cancel row that stays in view while a long form scrolls, so the primary action is
 * always within reach on a phone.
 */
export function StickyActions({ variant = 'dialog', className = '', children }: {
  variant?: keyof typeof VARIANT
  className?: string
  children: ReactNode
}) {
  return <div className={`flex gap-3 ${VARIANT[variant]} ${className}`}>{children}</div>
}
