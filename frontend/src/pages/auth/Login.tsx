import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { homePathFor, useAuth } from '../../auth/AuthContext'
import { Button, ErrorNote, Field } from '../../components/ui'
import AuthLayout from './AuthLayout'

export default function Login() {
  const { user, login, logout } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Always ask for a sign-in: a session still open from earlier is ended here, so the
  // form shows and signing in replaces it instead of skipping straight to a dashboard.
  useEffect(() => {
    if (user) logout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const signedIn = await login(identifier, password)
      navigate(homePathFor(signedIn.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" sub="Log in to see your jobs and money">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Phone number or email" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="0712 345 678" />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorNote message={error} />}
        <Button type="submit" tone="primary" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="text-center text-sm text-neutral-600">
        New here?{' '}
        <Link to="/register" className="font-bold text-brand-ink">
          Create an account
        </Link>
      </div>
    </AuthLayout>
  )
}
