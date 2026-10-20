import { useState } from 'react'

import { jobsApi } from '../../api/api'
import { ApiError } from '../../api/http'
import type { Job } from '../../api/types'
import { Button, Card, ErrorNote, Small } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/format'

// An open job with an Apply button (wireframes 10 and 11). The API has no
// "my applications" list, so "Applied" comes from this session or a 409.
export default function JobTile({ job }: { job: Job }) {
  const [applied, setApplied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await jobsApi.apply(job.id)
      setApplied(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /already applied/i.test(err.message)) setApplied(true)
      else setError(err instanceof Error ? err.message : 'Could not apply')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[17px] font-bold">{job.title}</div>
        <div className="shrink-0 text-[17px] font-bold">{formatMoney(job.budget, job.currency)}</div>
      </div>
      <Small className="mt-1 line-clamp-2">{job.description}</Small>
      <Small className="mt-2.5">Posted {formatDate(job.createdAt)}</Small>
      <div className="flex-1" />
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      {applied ? (
        <Button small icon="check" disabled className="mt-3.5 border-[#b7dfc4] bg-brand-tint text-brand-dark">Applied</Button>
      ) : (
        <Button small tone="primary" className="mt-3.5" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Applying…' : 'Apply'}
        </Button>
      )}
    </Card>
  )
}
