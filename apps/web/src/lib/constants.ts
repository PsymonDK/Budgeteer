export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL'

export type AccountType = 'BANK' | 'CREDIT_CARD' | 'MOBILE_PAY'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: 'Bank',
  CREDIT_CARD: 'Credit card',
  MOBILE_PAY: 'Mobile pay',
}

export function calcMonthly(amount: number, freq: Frequency): number {
  switch (freq) {
    case 'WEEKLY':      return amount * 52 / 12
    case 'FORTNIGHTLY': return amount * 26 / 12
    case 'MONTHLY':     return amount
    case 'QUARTERLY':   return amount / 3
    case 'BIANNUAL':    return amount / 6
    case 'ANNUAL':      return amount / 12
  }
}

export const FREQ_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  BIANNUAL: 'Every 6 months',
  ANNUAL: 'Annually',
}

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'WEEKLY',      label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'MONTHLY',     label: 'Monthly' },
  { value: 'QUARTERLY',   label: 'Quarterly' },
  { value: 'BIANNUAL',    label: 'Every 6 months' },
  { value: 'ANNUAL',      label: 'Annually' },
]
