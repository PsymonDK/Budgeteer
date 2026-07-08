type SelectableBudgetYear = {
  status: string
  year: number
}

export function pickDefaultBudgetYear<T extends SelectableBudgetYear>(years: T[]): T | null {
  const active = years
    .filter((year) => year.status === 'ACTIVE')
    .sort((a, b) => a.year - b.year)[0]
  if (active) return active

  return years
    .filter((year) => year.status === 'FUTURE')
    .sort((a, b) => a.year - b.year)[0] ?? null
}
