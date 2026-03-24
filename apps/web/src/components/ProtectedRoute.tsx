import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  children: ReactNode
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <div className="min-h-screen bg-gray-950" />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && user.role !== 'SYSTEM_ADMIN') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
