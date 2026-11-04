import { useState } from 'react'
import type { FormEvent } from 'react'

import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Banner, Button, Card, ErrorNote, Field, PageHead } from '../../components/ui'

// Lets a client or worker change their name and phone. The phone is the number
// M-Pesa payments and payouts use, and it is also a login identifier. The email
// is the account's identity, so it is shown but not editable.
export default function Profile() {
  const { user, updateProfile } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const changed = name.trim() !== user.name || phone.trim() !== (user.phone ?? '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await updateProfile({
        ...(name.trim() !== user.name && { name: name.trim() }),
        ...(phone.trim() !== (user.phone ?? '') && { phone: phone.trim() }),
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page header={<PageHead title="My Profile" sub="Your name and M-Pesa number" />}>
      <form onSubmit={submit} className="max-w-xl">
        <Card className="gap-3.5">
          <Field label="Full name" required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Field
            label="M-Pesa phone number"
            required
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712 345 678"
            hint={
              user.role === 'worker'
                ? 'Withdrawals are paid to this number. You can also sign in with it.'
                : 'Payments are requested from this number. You can also sign in with it.'
            }
          />
          <Field label="Email" value={user.email} disabled hint="Your email is your account identity and can’t be changed here." />
          {error && <ErrorNote message={error} />}
          {saved && <Banner tone="green" icon="check" title="Profile saved" />}
          <Button tone="primary" type="submit" disabled={busy || !changed || !name.trim() || !phone.trim()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </Card>
      </form>
    </Page>
  )
}
