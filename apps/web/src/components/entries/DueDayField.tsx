import type { Frequency } from '../../lib/constants'
import { inputClass } from '../../lib/styles'

/** Frequencies paid several times a month have no single due day. */
export const hasDueDay = (frequency: Frequency) => frequency !== 'WEEKLY' && frequency !== 'FORTNIGHTLY'

interface DueDayFieldProps {
  /** '' = no set day */
  value: string
  frequency: Frequency
  onChange: (value: string) => void
}

/** Optional day of the month (1–31) an entry is paid, shown on the dashboard's payments timeline. */
export function DueDayField({ value, frequency, onChange }: DueDayFieldProps) {
  if (!hasDueDay(frequency)) return null
  return (
    <div>
      <label htmlFor="due-day" className="block text-xs font-medium text-gray-400 mb-1">
        Due day <span className="text-gray-600">(optional)</span>
      </label>
      <input
        id="due-day"
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 1"
        aria-describedby="due-day-help"
        className={`${inputClass} max-w-[8rem]`}
      />
      <p id="due-day-help" className="text-xs text-gray-500 mt-1">
        Day of the month it leaves your account. Days past the month's end fall on its last day.
      </p>
    </div>
  )
}

/** Form string → API value: a whole day 1–31, or null for no set day (and for weekly/fortnightly). */
export function dueDayPayload(value: string, frequency: Frequency): number | null {
  if (!hasDueDay(frequency) || value.trim() === '') return null
  return parseInt(value, 10)
}

/** 1 → "1st", 22 → "22nd", 13 → "13th" */
export function ordinalDay(day: number): string {
  const tens = day % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
  return `${day}${suffix}`
}
