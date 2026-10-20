import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { jobsApi } from '../../api/api'
import type { Currency } from '../../api/types'
import { Page } from '../../components/AppShell'
import { PhotoPicker } from '../../components/Photos'
import { Button, Card, ErrorNote, Field, Label, PageHead, Select, Small, TextArea } from '../../components/ui'
import { getPosition } from '../../lib/geo'
import type { Position } from '../../lib/geo'

const STEPS = [
  'You pay into escrow with M-Pesa',
  'The worker does the job',
  'You check the work and release the money',
]

export default function PostJob() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState<Currency>('KES')
  const [budget, setBudget] = useState('')
  const [place, setPlace] = useState('')
  const [coords, setCoords] = useState<Position | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const useMyLocation = async () => {
    setLocating(true)
    setError(null)
    try {
      setCoords(await getPosition())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get your location')
    } finally {
      setLocating(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await jobsApi.post({
        title,
        description,
        currency,
        budget: Number(budget),
        ...(place.trim() && { location: { label: place.trim(), ...(coords ?? {}) } }),
        ...(photos.length > 0 && { photos }),
      })
      navigate('/client')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the job')
      setBusy(false)
    }
  }

  return (
    <Page header={<PageHead title="Post a Job" sub="Tell workers what you need done" />}>
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-3">
        <Card className="gap-3.5 md:col-span-2">
          <Field label="Job title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix kitchen sink" />
          <TextArea label="Describe the work" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The sink is leaking under the cupboard and the tap is loose." />
          <div>
            <Field label="Location" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Kilimani, Nairobi" />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-muted">
              <button type="button" disabled={locating} onClick={() => void useMyLocation()} className="font-bold text-brand disabled:opacity-50">
                {locating ? 'Finding you…' : coords ? 'Update my position' : 'Use my current position'}
              </button>
              {coords ? (
                <span>Position saved, so nearby workers can see how far away you are.</span>
              ) : (
                <span>Optional. Lets workers see how far the job is from them.</span>
              )}
              {coords && (
                <button type="button" onClick={() => setCoords(null)} className="underline">
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3.5 sm:flex-row">
            <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {(['KES', 'UGX', 'TZS', 'USD'] as const).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Field label="Budget" type="number" required min={1} step="any" value={budget} onChange={(e) => setBudget(e.target.value)} hint="You only pay into escrow after you choose a worker" />
          </div>
          <div>
            <div className="mb-1.5 text-sm font-bold text-neutral-700">Photos (optional)</div>
            <PhotoPicker photos={photos} onChange={setPhotos} />
          </div>
        </Card>

        <Card>
          <Label>How payment works</Label>
          {STEPS.map((step, i) => (
            <div key={step} className="mt-3.5 flex items-center gap-3">
              <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-tint font-bold text-brand-dark">
                {i + 1}
              </div>
              <div className="text-[15px]">{step}</div>
            </div>
          ))}
          <Small className="mt-3.5">Your money is held safely the whole time.</Small>
          <div className="flex-1" />
          {error && <div className="mt-4"><ErrorNote message={error} /></div>}
          <Button type="submit" tone="primary" disabled={busy} className="mt-4">
            {busy ? 'Posting…' : 'Post Job'}
          </Button>
        </Card>
      </form>
    </Page>
  )
}
