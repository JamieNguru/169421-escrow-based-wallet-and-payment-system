import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { authApi } from '../api/api'
import { setToken, setUnauthorizedHandler } from '../api/http'
import type { Role, User } from '../api/types'

const STORAGE_KEY = 'escrow.session'

interface Session {
  token: string
  user: User
}

interface AuthValue {
  user: User | null
  login: (identifier: string, password: string) => Promise<User>
  logout: () => void
  acceptTerms: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

// The initial read also hands the token to the HTTP layer before any page loads.
const initial = readSession()
if (initial) setToken(initial.token)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(initial)

  const logout = useCallback(() => {
    setToken(null)
    localStorage.removeItem(STORAGE_KEY)
    setSession(null)
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    const next = await authApi.login(identifier, password)
    setToken(next.token)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
    return next.user
  }, [])

  const acceptTerms = useCallback(async () => {
    await authApi.acceptTerms()
    setSession((current) => {
      if (!current) return current
      const next = { ...current, user: { ...current.user, termsAccepted: true } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const value = useMemo(() => ({ user: session?.user ?? null, login, logout, acceptTerms }), [session, login, logout, acceptTerms])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

export const homePathFor = (role: Role) => `/${role}`
