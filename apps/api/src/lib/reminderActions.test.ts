import { describe, expect, it } from 'vitest'
import { hashToken, newToken, tokenState } from './reminderActions'
import { renderDigestEmail } from './digestEmail'

describe('Mark-as-paid tokens', () => {
  it('are long and random, and only their hash is kept', () => {
    const a = newToken()
    const b = newToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).toBe(hashToken(a.token))
    expect(a.tokenHash).not.toContain(a.token)
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('work until used or expired', () => {
    const now = new Date('2026-09-30T10:00:00Z')
    const later = new Date('2026-10-14T10:00:00Z')
    expect(tokenState({ expiresAt: later, usedAt: null }, now)).toBe('VALID')
    expect(tokenState({ expiresAt: later, usedAt: now }, now)).toBe('USED')
    expect(tokenState({ expiresAt: now, usedAt: null }, now)).toBe('EXPIRED')
    expect(tokenState(null, now)).toBe('INVALID')
  })

  it('a tampered token matches nothing: its hash differs', () => {
    const { token, tokenHash } = newToken()
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(hashToken(tampered)).not.toBe(tokenHash)
  })
})

describe('Mark-as-paid links in email', () => {
  it('links each reminder to its confirm page', () => {
    const reminder = {
      stage: 'DUE_TODAY' as const, daysUntilDue: 0,
      item: { key: 'expense:tv', kind: 'expense' as const, label: 'Netflix', amount: '18', dueDate: '2026-09-30', householdId: 'h1', householdName: 'Home', budgetYearId: 'b', recipientIds: ['a'] },
    }
    const email = renderDigestEmail({
      recipientName: 'Anna', appUrl: 'https://b.example', currency: 'DKK',
      digest: { date: '2026-09-30', reminders: [reminder] },
      actionUrls: new Map([['DUE_TODAY:expense:tv', 'https://b.example/r/tok']]),
    })
    expect(email.text).toContain('Mark as paid: https://b.example/r/tok')
    expect(email.html).toContain('href="https://b.example/r/tok"')
  })
})
