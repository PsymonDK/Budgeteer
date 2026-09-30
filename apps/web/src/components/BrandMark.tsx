/**
 * Budgeteer's mark: a doubloon with a compass rose. Drawn in `currentColor` (brass by default where
 * it's used); `cutout` is the colour of the surface behind it, used for the shaded rose halves.
 */
export function BrandMark({ size = 24, className = 'text-amber-400', cutout = 'rgb(var(--sea-900))' }: {
  size?: number
  className?: string
  cutout?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="11.6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.2 1.6" />
      <path d="M16 5.2 L17.3 14.7 L26.8 16 L17.3 17.3 L16 26.8 L14.7 17.3 L5.2 16 L14.7 14.7 Z" fill="currentColor" />
      <path
        d="M16 5.2 L17.3 14.7 L16 16 Z M26.8 16 L17.3 17.3 L16 16 Z M16 26.8 L14.7 17.3 L16 16 Z M5.2 16 L14.7 14.7 L16 16 Z"
        fill={cutout}
        opacity=".55"
      />
      <circle cx="16" cy="16" r="1.5" fill={cutout} />
    </svg>
  )
}

/** Mark plus the "Budgeteer" wordmark in the display face. */
export function BrandLogo({ size = 24, cutout, wordmarkClassName = '' }: { size?: number; cutout?: string; wordmarkClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} cutout={cutout} />
      <span className={`font-display text-xl leading-none text-gray-100 ${wordmarkClassName}`}>Budgeteer</span>
    </span>
  )
}
