import crypto from 'crypto'
import { prisma } from './prisma'

export const ACCESS_TOKEN_TTL = '15m'
export const REFRESH_TOKEN_EXPIRY_DAYS = 7

// Two tabs can refresh with the same token at the same moment; the loser presents a
// just-rotated token. Within this window that's treated as a race, not theft.
export const REUSE_GRACE_MS = 30_000

type SignAccessToken = (payload: { sub: string; email: string; role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER' }) => string

/** Refresh tokens are stored as SHA-256 hashes so a database leak doesn't leak sessions. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * True when an access token was issued before the user's sessions were revoked.
 * JWT `iat` has second precision, so revocation is stored rounded down to the second.
 */
export function issuedBeforeRevocation(iatSeconds: number | undefined, sessionsValidAfter: Date | null): boolean {
  if (!sessionsValidAfter) return false
  if (iatSeconds === undefined) return true
  return iatSeconds * 1000 < sessionsValidAfter.getTime()
}

export async function issueSession(
  user: { id: string; email: string; role: 'SYSTEM_ADMIN' | 'BOOKKEEPER' | 'USER' },
  sign: SignAccessToken,
): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = crypto.randomBytes(40).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)
  await prisma.refreshToken.create({ data: { token: hashToken(refreshToken), userId: user.id, expiresAt } })
  return { accessToken: sign({ sub: user.id, email: user.email, role: user.role }), refreshToken }
}

export type RotateResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; reason: 'invalid' | 'reused' | 'inactive' }

/**
 * Exchanges a refresh token for a new pair. The old token is marked revoked rather
 * than deleted, so presenting it again later reveals a stolen token: every session of
 * that user is then revoked.
 */
export async function rotateRefreshToken(rawToken: string, sign: SignAccessToken, now: Date = new Date()): Promise<RotateResult> {
  const stored =
    (await prisma.refreshToken.findUnique({ where: { token: hashToken(rawToken) } })) ??
    // Tokens issued before hashing was introduced are stored raw
    (await prisma.refreshToken.findUnique({ where: { token: rawToken } }))
  if (!stored || stored.expiresAt < now) return { ok: false, reason: 'invalid' }

  if (stored.revokedAt) {
    if (now.getTime() - stored.revokedAt.getTime() > REUSE_GRACE_MS) {
      await revokeAllSessions(stored.userId, now)
      return { ok: false, reason: 'reused' }
    }
    return { ok: false, reason: 'invalid' }
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } })
  if (!user || !user.isActive || user.isProxy) return { ok: false, reason: 'inactive' }

  // Only one concurrent request can win the rotation
  const claimed = await prisma.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: now } })
  if (claimed.count === 0) return { ok: false, reason: 'invalid' }

  const session = await issueSession(user, sign)
  return { ok: true, ...session }
}

/**
 * Ends every session of a user: refresh tokens are deleted and access tokens issued
 * before now stop being accepted. Used on password change/reset and role changes.
 */
export async function revokeAllSessions(userId: string, now: Date = new Date()): Promise<void> {
  const validAfter = new Date(Math.floor(now.getTime() / 1000) * 1000)
  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { sessionsValidAfter: validAfter } }),
  ])
}

/** Removes expired tokens and rotated ones past the reuse-detection horizon. */
export async function purgeRefreshTokens(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() - REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: horizon } }] },
  })
  return count
}
