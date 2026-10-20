import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { escrowApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { PhotoPicker } from '../../components/Photos'
import { Button, Card, ErrorNote, Label, PageHead, Small, TextArea } from '../../components/ui'
import { formatMoney } from '../../lib/format'
import { useAsync } from '../../hooks/useAsync'

const REASONS = [
  'The work was not finished',
  'The work was done badly',
  'The worker did not come',
  'Something else',
]

// Raise a dispute on a job (wireframe 08). The money stays in escrow until an admin decides.
export default function ReportProblem() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const escrow = useAsync(() => escrowApi.get(jobId))
  const [reason, setReason] = useState(REASONS[0])
  const [details, setDetails] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await escrowApi.dispute(jobId, details.trim() ? `${reason}: ${details.trim()}` : reason, photos)
      navigate('/client')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your report')
      setBusy(false)
    }
  }

  const amount = escrow.data ? formatMoney(escrow.data.amount, escrow.data.currency) : ''

  return (
    <Page header={<PageHead title="Report a problem" sub={amount ? `${amount} held safely` : undefined} />}>
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="gap-3.5 md:col-span-2">
          <div className="text-sm font-bold text-neutral-700">What went wrong?</div>
          <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup">
            {REASONS.map((r) => {
              const on = r === reason
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setReason(r)}
                  className={`flex items-center gap-2.5 rounded-2xl px-4 py-3.5 text-left text-[15px] font-medium transition ${on ? 'border-[1.5px] border-brand bg-brand-tint ring-4 ring-brand/10' : 'border-[1.5px] border-line bg-white hover:border-neutral-300'}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand">
                    {on && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                  </span>
                  {r}
                </button>
              )
            })}
          </div>
          <TextArea label="Tell us more" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={900} placeholder="Only the front of the gate was painted. The back was not done." />
          <div>
            <div className="mb-1.5 text-sm font-bold text-neutral-700">Add photos (optional)</div>
            <PhotoPicker photos={photos} onChange={setPhotos} />
          </div>
        </Card>
        <Card>
          <Label>What happens next</Label>
          <Small className="mt-3 text-[14.5px] leading-snug">
            The money stays held safely. An admin will look at both sides and decide.
          </Small>
          <div className="flex-1" />
          {error && <div className="mt-4"><ErrorNote message={error} /></div>}
          <Button tone="danger" icon="flag" className="mt-4" disabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send to admin'}
          </Button>
        </Card>
      </div>
    </Page>
  )
}
