import { useState } from 'react'

import { jobsApi } from '../../api/api'
import { ApiError } from '../../api/http'
import type { Job, MyApplication } from '../../api/types'
import Icon from '../../components/Icon'
import { PhotoGallery } from '../../components/Photos'
import { Button, Card, ErrorNote, Field, LinkButton, Small, TextArea } from '../../components/ui'
import { formatDate, formatHours, formatMoney } from '../../lib/format'

// An open job where the worker sends a quote (wireframes 10 and 11). The
// client's budget is only a guide: the price the worker sends is the one that
// is locked in if they are chosen. A quote sent earlier comes back with the job.
export default function JobTile({ job, verified }: { job: Job; verified: boolean }) {
  const [quote, setQuote] = useState<MyApplication | undefined>(job.myApplication)
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState('')
  const [hours, setHours] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<string[] | null>(null)
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  const amount = Number(price)
  const validPrice = price !== '' && Number.isFinite(amount) && amount > 0
  const promisedHours = Number(hours)
  const validHours = hours !== '' && Number.isFinite(promisedHours) && promisedHours > 0 && promisedHours <= 720

  const openPanel = () => {
    setPrice(quote?.price !== undefined ? String(quote.price) : '')
    setHours(quote?.deliveryHours !== undefined ? String(quote.deliveryHours) : '')
    setMessage(quote?.message ?? '')
    setError(null)
    setEditing(true)
  }

  const send = async () => {
    if (!validPrice || !validHours) return
    setBusy(true)
    setError(null)
    try {
      setQuote(
        quote
          ? await jobsApi.updateQuote(job.id, { price: amount, deliveryHours: promisedHours, message: message.trim() })
          : await jobsApi.apply(job.id, amount, promisedHours, message.trim() || undefined),
      )
      setEditing(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /already applied/i.test(err.message)) {
        setError('You already sent a quote for this job. Reload to see it.')
      } else setError(err instanceof Error ? err.message : 'Could not send your quote')
    } finally {
      setBusy(false)
    }
  }

  // Photos are heavy, so they are fetched only when the worker asks to see them.
  const togglePhotos = async () => {
    if (photos) return setPhotos(null)
    setLoadingPhotos(true)
    setError(null)
    try {
      setPhotos((await jobsApi.get(job.id)).photos ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the photos')
    } finally {
      setLoadingPhotos(false)
    }
  }

  const place = job.location?.label
  const count = job.photoCount ?? 0

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[17px] font-bold">{job.title}</div>
        <div className="shrink-0 text-right">
          <div className="text-[17px] font-bold">{formatMoney(job.budget, job.currency)}</div>
          <Small>Client’s budget</Small>
        </div>
      </div>
      {place && (
        <Small className="mt-1 flex items-center gap-1">
          <Icon name="pin" size={16} />
          {place}
          {job.distanceKm !== undefined && ` · ${job.distanceKm} km`}
        </Small>
      )}
      <Small className="mt-1 line-clamp-2">{job.description}</Small>
      <Small className="mt-2.5">Posted {formatDate(job.createdAt)}</Small>
      {count > 0 && (
        <button type="button" onClick={() => void togglePhotos()} disabled={loadingPhotos} className="mt-2 self-start text-sm font-bold text-brand-ink disabled:opacity-50">
          {loadingPhotos ? 'Loading photos…' : photos ? 'Hide photos' : `View ${count} ${count === 1 ? 'photo' : 'photos'}`}
        </button>
      )}
      {photos && photos.length > 0 && <div className="mt-2"><PhotoGallery photos={photos} /></div>}
      <div className="flex-1" />
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      {editing ? (
        <div className="mt-3.5 flex flex-col gap-3 border-t border-line pt-3.5">
          <Field
            label={`Your price (${job.currency})`}
            type="number"
            min={1}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            hint="Once the client chooses you, this price is locked and they pay exactly this."
          />
          <Field
            label="Delivery time (hours)"
            type="number"
            min={1}
            max={720}
            step="any"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            hint="Counted from when the client pays into escrow. Finishing later than this lowers your trust score."
          />
          <TextArea label="Message (optional)" value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
          <div className="flex gap-2">
            <Button small tone="primary" disabled={busy || !validPrice || !validHours} onClick={() => void send()}>
              {busy ? 'Sending…' : quote ? 'Save quote' : 'Send quote'}
            </Button>
            <Button small disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : quote ? (
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <Button small icon="check" disabled className="w-auto flex-1 border-brand/30 bg-brand-tint text-brand-ink">
            {quote.price !== undefined
              ? `Quote sent: ${formatMoney(quote.price, quote.currency ?? job.currency)}${quote.deliveryHours !== undefined ? ` in ${formatHours(quote.deliveryHours)}` : ''}`
              : 'Applied'}
          </Button>
          {quote.status === 'pending' && (
            <Button small className="w-auto px-4" onClick={openPanel}>Edit quote</Button>
          )}
        </div>
      ) : verified ? (
        <Button small tone="primary" className="mt-3.5" onClick={openPanel}>Send your quote</Button>
      ) : (
        <LinkButton to="/worker/verification" small icon="lock" className="mt-3.5">Verify your identity to apply</LinkButton>
      )}
    </Card>
  )
}
