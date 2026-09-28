import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { api } from '../api/client'
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
    const stored = localStorage.getItem('user')
    if (!stored) {
      setIsLoading(false)
      return
    }
    try {
      setUser(JSON.parse(stored) as AuthUser)
    } catch {
      localStorage.removeItem('user')
      setIsLoading(false)
      return
    }
    // Refresh user data from the server so name/email/role are always current
    api.get<AuthUser>('/users/me')
      .then((res) => {
        setUser(res.data)
        localStorage.setItem('user', JSON.stringify(res.data))
      })
      .catch((err) => {
        // Only an auth failure ends the session. Network errors or a restarting
        // API keep the stored user so the app recovers on the next request.
        const status = axios.isAxiosError(err) ? err.response?.status : undefined
        if (status !== 401 && status !== 403) return
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('user')
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login',
      { email, password }
    )
    localStorage.setItem('accessToken', res.data.accessToken)
    localStorage.setItem('refreshToken', res.data.refreshToken)
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
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        await api.post('/auth/logout', { refreshToken })
      }
    } finally {
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
