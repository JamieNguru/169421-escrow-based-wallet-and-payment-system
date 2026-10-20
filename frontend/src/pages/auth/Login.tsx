import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { homePathFor, useAuth } from '../../auth/AuthContext'
import { Button, ErrorNote, Field } from '../../components/ui'
import AuthLayout from './AuthLayout'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homePathFor(user.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const signedIn = await login(email, password)
      navigate(homePathFor(signedIn.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" sub="Log in to see your jobs and money">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorNote message={error} />}
        <Button type="submit" tone="primary" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="text-center text-sm text-neutral-600">
        New here?{' '}
        <Link to="/register" className="font-bold text-brand">
          Create an account
        </Link>
      </div>
    </AuthLayout>
  )
}
