import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  children: ReactNode
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <div className="min-h-screen bg-gray-950" />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  if (requireAdmin && user.role !== 'SYSTEM_ADMIN') {
    return <Navigate to="/403" replace />
  }

  return <>{children}</>
}
