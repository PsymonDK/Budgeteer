// Encrypts small secrets stored in the database (the SMTP password) with AES-256-GCM, so a
// database dump alone doesn't reveal them. The key comes from SETTINGS_ENCRYPTION_KEY, or,
// when that isn't set, is derived from JWT_SECRET; changing the key means re-entering the
// secrets. Stored as "v1:<iv>:<tag>:<ciphertext>" (base64url).
import crypto from 'crypto'

const VERSION = 'v1'

/** A 32-byte key from the configured secret. */
export function settingsKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const explicit = env.SETTINGS_ENCRYPTION_KEY
  if (explicit) return crypto.createHash('sha256').update(explicit).digest()
  const jwtSecret = env.JWT_SECRET
  if (!jwtSecret) throw new Error('Set SETTINGS_ENCRYPTION_KEY (or JWT_SECRET) to store secrets')
  return Buffer.from(crypto.hkdfSync('sha256', jwtSecret, 'budgeteer', 'settings-encryption', 32))
}

export function encryptSecret(plaintext: string, key: Buffer = settingsKey()): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':')
}

/** Throws when the value was tampered with or encrypted with another key. */
export function decryptSecret(stored: string, key: Buffer = settingsKey()): string {
  const [version, iv, tag, ciphertext] = stored.split(':')
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised encrypted value')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
