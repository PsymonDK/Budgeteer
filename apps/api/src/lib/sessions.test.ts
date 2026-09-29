import { describe, it, expect } from 'vitest'
import { hashToken, issuedBeforeRevocation, refreshCookieOptions } from './sessions'

describe('hashToken', () => {
  it('is a stable SHA-256 hex digest that differs from the token', () => {
    const h = hashToken('abc')
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashToken('abc')).toBe(h)
    expect(h).not.toContain('abc')
  })
})

describe('issuedBeforeRevocation', () => {
  const revokedAt = new Date('2026-09-28T12:00:00.000Z')
  const iat = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

  it('accepts every token when sessions were never revoked', () => {
    expect(issuedBeforeRevocation(iat('2020-01-01T00:00:00Z'), null)).toBe(false)
  })

  it('rejects tokens issued before the revocation', () => {
    expect(issuedBeforeRevocation(iat('2026-09-28T11:59:59Z'), revokedAt)).toBe(true)
  })

  it('accepts tokens issued in or after the revocation second (the new session)', () => {
    expect(issuedBeforeRevocation(iat('2026-09-28T12:00:00Z'), revokedAt)).toBe(false)
    expect(issuedBeforeRevocation(iat('2026-09-28T12:05:00Z'), revokedAt)).toBe(false)
  })

  it('rejects tokens without an issue time once sessions were revoked', () => {
    expect(issuedBeforeRevocation(undefined, revokedAt)).toBe(true)
  })
})

describe('refreshCookieOptions', () => {
  it('keeps the refresh token away from page scripts and cross-site requests', () => {
    expect(refreshCookieOptions(false)).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/', secure: false })
  })

  it('marks the cookie Secure when the browser used HTTPS', () => {
    expect(refreshCookieOptions(true).secure).toBe(true)
  })

  it('lives as long as the refresh token', () => {
    expect(refreshCookieOptions(true).maxAge).toBe(7 * 24 * 60 * 60)
  })
})
