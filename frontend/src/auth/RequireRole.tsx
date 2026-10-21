import { Navigate, Outlet } from 'react-router-dom'

import type { Role } from '../api/types'
import { homePathFor, useAuth } from './AuthContext'

// Wraps a role's routes: signed-out visitors go to login, other roles go to their own home.
export default function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={homePathFor(user.role)} replace />
  return <Outlet />
}
