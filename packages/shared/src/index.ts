export const Frequency = {
  WEEKLY: 'WEEKLY',
  FORTNIGHTLY: 'FORTNIGHTLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  BIANNUAL: 'BIANNUAL',
  ANNUAL: 'ANNUAL'
} as const

export type FrequencyType = keyof typeof Frequency

export function calculateMonthlyEquivalent(
  amount: number,
  frequency: FrequencyType
): number {
  const multipliers: Record<FrequencyType, number> = {
    WEEKLY: 52 / 12,
    FORTNIGHTLY: 26 / 12,
    MONTHLY: 1,
    QUARTERLY: 1 / 3,
    BIANNUAL: 1 / 6,
    ANNUAL: 1 / 12
  }
  return Math.round(amount * multipliers[frequency] * 100) / 100
}