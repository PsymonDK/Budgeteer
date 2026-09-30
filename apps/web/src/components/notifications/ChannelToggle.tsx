/**
 * One notification channel's on/off setting. When the level above (the install or the
 * household) has the channel off it's shown unticked and disabled, with the reason.
 */
export function ChannelToggle({ id, label, description, checked, onChange, allowed = true, blockedNote }: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** False when the level above has this channel off */
  allowed?: boolean
  /** Why it can't be turned on, when not allowed */
  blockedNote?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={allowed && checked}
        disabled={!allowed}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-0.5 w-4 h-4 rounded accent-amber-400 disabled:cursor-not-allowed"
      />
      <div className="min-w-0">
        <label htmlFor={id} className={`text-sm font-medium ${allowed ? 'text-gray-100' : 'text-gray-500'}`}>{label}</label>
        <p id={`${id}-help`} className="text-xs text-gray-500 mt-0.5">
          {allowed ? description : blockedNote ?? 'Turned off at a higher level.'}
        </p>
      </div>
    </div>
  )
}
