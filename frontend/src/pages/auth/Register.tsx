import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { authApi } from '../../api/api'
import { homePathFor, useAuth } from '../../auth/AuthContext'
import Icon from '../../components/Icon'
import { Button, ErrorNote, Field } from '../../components/ui'
import AuthLayout from './AuthLayout'

type SignupRole = 'client' | 'worker'

const ROLES: Array<{ role: SignupRole; title: string; sub: string }> = [
  { role: 'client', title: 'I want to hire', sub: 'Post jobs and pay safely (Client)' },
  { role: 'worker', title: 'I want to work', sub: 'Find jobs and get paid (Worker)' },
]

export default function Register() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<SignupRole>('client')
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homePathFor(user.role)} replace />

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await authApi.register({ ...form, role })
      const signedIn = await login(form.email, form.password)
      navigate(homePathFor(signedIn.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Create your account" sub="Step 1: What do you want to do?" width="max-w-[760px]">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3.5 sm:flex-row">
          {ROLES.map((r) => {
            const on = r.role === role
            return (
              <button
                key={r.role}
                type="button"
                onClick={() => setRole(r.role)}
                aria-pressed={on}
                className={`flex flex-1 items-center justify-between rounded-xl p-4 text-left ${
                  on ? 'border-2 border-brand bg-brand-tint' : 'border-[1.5px] border-line'
                }`}
              >
                <div>
                  <div className="text-[17px] font-bold">{r.title}</div>
                  <div className="text-sm text-neutral-600">{r.sub}</div>
                </div>
                {on && (
                  <span className="text-brand">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field label="Full name" required value={form.name} onChange={set('name')} autoComplete="name" />
          <Field label="M-Pesa phone number" required value={form.phone} onChange={set('phone')} placeholder="0712 345 678" autoComplete="tel" />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field label="Email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          <Field label="Password" type="password" required minLength={8} value={form.password} onChange={set('password')} hint="At least 8 characters" autoComplete="new-password" />
        </div>
        {error && <ErrorNote message={error} />}
        <Button type="submit" tone="primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <div className="text-center text-sm text-neutral-600">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-brand">
          Log in
        </Link>
      </div>
    </AuthLayout>
  )
}
