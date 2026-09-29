import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query, e.g. `useMediaQuery('(min-width: 1024px)')`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
