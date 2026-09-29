import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, isSessionEnded, refreshAccessToken, setAccessToken } from '../api/client'
import { ACTIVE_HOUSEHOLD_KEY } from '../lib/storageKeys'
import type { UserRole } from '../api/types'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
  isProxy: boolean
  avatarUrl?: string | null
  mustChangePassword: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateUser: (updates: Partial<AuthUser>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    // "user" in localStorage is only a hint that a session cookie may exist (the
    // cookie itself is httpOnly and invisible here); sessions from before the
    // cookie switch still have a refresh token there, which the first refresh swaps.
    const stored = localStorage.getItem('user')
    const hasLegacySession = localStorage.getItem('refreshToken') !== null
    if (!stored && !hasLegacySession) {
      setIsLoading(false)
      return
    }
    if (stored) {
      try {
        setUser(JSON.parse(stored) as AuthUser)
      } catch {
        localStorage.removeItem('user')
      }
    }
    // Get an access token from the refresh cookie, then load the current user so
    // name/email/role are always up to date
    refreshAccessToken()
      .then(() => api.get<AuthUser>('/users/me'))
      .then((res) => {
        setUser(res.data)
        localStorage.setItem('user', JSON.stringify(res.data))
      })
      .catch((err) => {
        // Only an auth failure ends the session. Network errors or a restarting
        // API keep the stored user so the app recovers on the next request.
        if (!isSessionEnded(err)) return
        localStorage.removeItem('user')
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function login(email: string, password: string) {
    // The refresh token arrives as an httpOnly cookie; the access token stays in memory
    const res = await api.post<{ accessToken: string; user: AuthUser }>(
      '/auth/login',
      { email, password }
    )
    setAccessToken(res.data.accessToken)
    localStorage.setItem('user', JSON.stringify(res.data.user))
    setUser(res.data.user)
  }

  const updateUser = useCallback((updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...updates }
      localStorage.setItem('user', JSON.stringify(next))
      return next
    })
  }, [])

  async function logout() {
    try {
      // Revokes the refresh token and clears its cookie
      await api.post('/auth/logout', {})
    } finally {
      setAccessToken(null)
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('user')
      localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY)
      // Drop every cached query so the next user in this tab never sees this user's data
      queryClient.clear()
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
