import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import type { Role } from './currentUser'
import LoadingSpinner from '../shared/components/LoadingSpinner'

interface RequireRoleProps {
  role: Role
  children: ReactNode
}

export default function RequireRole({ role, children }: RequireRoleProps) {
  const { user, loading } = useAuth()

  // Resolve the session before deciding, so we never flash a redirect.
  if (loading) {
    return <LoadingSpinner />
  }

  if (user?.role !== role) {
    return <Navigate to="/login" replace />
  }

  return children
}
