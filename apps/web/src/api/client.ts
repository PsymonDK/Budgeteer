import axios, { InternalAxiosRequestConfig } from 'axios'

// /api is proxied to the API by nginx in Docker and by the Vite dev server
// locally. Set VITE_API_URL (in apps/web/.env) only to bypass the proxy.
const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

// ── Tokens ────────────────────────────────────────────────────────────────────
// The refresh token lives in an httpOnly cookie that page scripts can't read, so
// an XSS bug can't take it elsewhere. The short-lived access token is kept only
// in memory; after a reload it is re-issued from the cookie.

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

// Sessions from before the cookie switch kept both tokens in localStorage
const LEGACY_TOKEN_KEYS = ['accessToken', 'refreshToken']

let refreshing: Promise<string> | null = null

/**
 * A new access token from the refresh cookie. Concurrent callers share one request,
 * since every refresh rotates the cookie.
 */
export function refreshAccessToken(): Promise<string> {
  refreshing ??= requestNewAccessToken().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function requestNewAccessToken(): Promise<string> {
  // One-time migration: hand an old localStorage refresh token to the API, which
  // swaps it for a cookie. Removed right away so it never lingers in page storage.
  const legacyRefreshToken = localStorage.getItem('refreshToken')
  LEGACY_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key))

  const post = () =>
    axios.post<{ accessToken: string }>(`${API_URL}/auth/refresh`, legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {})
  let response
  try {
    response = await post()
  } catch (err) {
    // Another tab may have rotated the cookie a moment ago; its response set the
    // new cookie, so one retry picks it up instead of logging this tab out.
    if (!legacyRefreshToken && axios.isAxiosError(err) && err.response?.status === 401) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      response = await post()
    } else {
      throw err
    }
  }
  accessToken = response.data.accessToken
  return accessToken
}

/** True when a failed refresh means the session is over (not a network hiccup). */
export function isSessionEnded(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)
}

// Attach the access token to every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// Silent token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error)

    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // /auth/* calls (login, refresh, logout) report their own 401s; retrying
    // them through the refresh flow would bounce a failed login to /login.
    const isAuthCall = originalRequest?.url?.startsWith('/auth/') ?? false
    if (error.response?.status !== 401 || originalRequest._retry || isAuthCall) {
      return Promise.reject(error)
    }
    originalRequest._retry = true

    try {
      const token = await refreshAccessToken()
      originalRequest.headers.Authorization = `Bearer ${token}`
      return api(originalRequest)
    } catch (refreshError) {
      // Only a rejected refresh ends the session; a network error leaves it intact
      if (isSessionEnded(refreshError)) {
        accessToken = null
        localStorage.removeItem('user')
        redirectToLogin()
      }
      return Promise.reject(refreshError)
    }
  }
)

// Pages that work signed out: an ended session mustn't send them to /login
// (/r/:token is a Mark-as-paid link from a reminder email)
const PUBLIC_PATHS = [/^\/login$/, /^\/r\//]

function redirectToLogin() {
  if (!PUBLIC_PATHS.some((p) => p.test(window.location.pathname))) {
    window.location.href = '/login'
  }
}
