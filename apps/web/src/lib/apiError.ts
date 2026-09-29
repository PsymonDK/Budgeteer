import axios from 'axios'

/** Extracts the API's `{ error }` message from a failed request, or returns the fallback. */
export function getApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { error?: unknown } | undefined)?.error
    if (typeof message === 'string' && message) return message
  }
  return fallback
}
