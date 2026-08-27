import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { currentUser, type Role } from './currentUser'

interface RequireRoleProps {
  role: Role
  children: ReactNode
}

export default function RequireRole({ role, children }: RequireRoleProps) {
  if (currentUser?.role !== role) {
    return <Navigate to="/login" replace />
  }

  return children
}
