// Local-calendar date strings for form defaults. `toISOString()` converts to UTC
// first, which yields the previous day around midnight in UTC+1/+2 (Denmark).

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM-DD for the given date in the browser's local time zone. */
export function toLocalISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM for the given date in the browser's local time zone. */
export function toLocalISOMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** YYYY-MM-01 for the current local month. */
export function startOfLocalMonthISO(d: Date = new Date()): string {
  return `${toLocalISOMonth(d)}-01`
}
