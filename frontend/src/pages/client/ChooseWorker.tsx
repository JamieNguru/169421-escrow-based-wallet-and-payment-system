import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { jobsApi } from '../../api/api'
import type { Application, Job, TrustLevel } from '../../api/types'
import { Page } from '../../components/AppShell'
import { KycDetails, VerifiedBadge } from '../../components/KycSummary'
import { Async, Banner, Button, Card, Chip, Empty, ErrorNote, PageHead, Select, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

type SortBy = 'price' | 'trust'

const TRUST_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1, New: 0 }

// A quote falls back to the client's budget for applications made before workers set prices.
const quoteOf = (a: Application, job?: Job) => ({
  amount: a.price ?? job?.budget ?? 0,
  currency: a.currency ?? job?.currency ?? 'KES',
})

// Applicants for one job (wireframe 05). Each one names their price. Choosing one
// locks that price, then the client pays exactly that into escrow.
export default function ChooseWorker() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const jobs = useAsync(jobsApi.mine)
  const applicants = useAsync(() => jobsApi.applications(jobId))
  const [sortBy, setSortBy] = useState<SortBy>('price')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [viewKycId, setViewKycId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const job = jobs.data?.find((j) => j.id === jobId)

  const choose = async (workerId: string) => {
    setBusyId(workerId)
    setError(null)
    try {
      await jobsApi.select(jobId, workerId)
      navigate(`/client/jobs/${jobId}/pay`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not choose this worker')
      setBusyId(null)
    }
  }

  const sorted = (list: Application[]) =>
    [...list].sort((a, b) =>
      sortBy === 'price'
        ? quoteOf(a, job).amount - quoteOf(b, job).amount
        : (TRUST_RANK[b.worker.trustLevel as TrustLevel] ?? -1) - (TRUST_RANK[a.worker.trustLevel as TrustLevel] ?? -1),
    )

  return (
    <Page
      header={
        <PageHead
          title={job?.title ?? 'Choose a worker'}
          sub={job ? `${job.applicantCount ?? 0} applied · Your budget ${formatMoney(job.budget, job.currency)}` : undefined}
        />
      }
    >
      <Banner icon="shield">
        <b>Trust level</b> is worked out from each worker’s history on the platform. The price a worker quotes is locked
        when you choose them, and you pay into escrow only after you choose.
      </Banner>
      {error && <ErrorNote message={error} />}
      <Async state={applicants}>
        {(list) =>
          list.length === 0 ? (
            <Empty>Nobody has applied yet.</Empty>
          ) : (
            <>
              <div className="max-w-xs">
                <Select label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                  <option value="price">Lowest price</option>
                  <option value="trust">Highest trust</option>
                </Select>
              </div>
              {sorted(list).map((a) => {
                const quote = quoteOf(a, job)
                const diff = job && quote.currency === job.currency ? quote.amount - job.budget : null
                const confirming = confirmId === a.workerId
                return (
                  <Card key={a.id} className="gap-3.5 py-3.5">
                    <div className="flex flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-neutral-400 bg-neutral-300 font-bold text-neutral-700">
                          {a.worker.name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-[17px] font-bold">
                            {a.worker.name}
                            {a.worker.kyc && <VerifiedBadge />}
                          </div>
                          <Small className="mt-0.5">{a.message || 'No message'}</Small>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                        <div className="text-right">
                          <div className="text-[17px] font-bold">{formatMoney(quote.amount, quote.currency)}</div>
                          {diff !== null && (
                            <Chip tone={diff > 0 ? 'amber' : 'green'}>
                              {diff === 0 ? 'At your budget' : `${formatMoney(Math.abs(diff), quote.currency)} ${diff > 0 ? 'above' : 'below'} budget`}
                            </Chip>
                          )}
                        </div>
                        {a.worker.trustLevel && <TrustBadge level={a.worker.trustLevel} />}
                        <Button
                          small
                          tone={a.status === 'pending' ? 'outline' : 'primary'}
                          className="w-[120px] shrink-0"
                          disabled={busyId !== null || a.status !== 'pending'}
                          onClick={() => setConfirmId(confirming ? null : a.workerId)}
                        >
                          {a.status === 'selected' ? 'Chosen' : confirming ? 'Cancel' : 'Choose'}
                        </Button>
                      </div>
                    </div>
                    {a.worker.kyc && (
                      <div className="border-t border-line pt-3">
                        <button
                          type="button"
                          aria-expanded={viewKycId === a.workerId}
                          onClick={() => setViewKycId(viewKycId === a.workerId ? null : a.workerId)}
                          className="text-sm font-bold text-brand-ink"
                        >
                          {viewKycId === a.workerId ? 'Hide verification' : 'View verification'}
                        </button>
                        {viewKycId === a.workerId && <div className="mt-2"><KycDetails kyc={a.worker.kyc} /></div>}
                      </div>
                    )}
                    {confirming && (
                      <div className="flex flex-col gap-3 border-t border-line pt-3.5">
                        <Small>
                          You will pay <b>{formatMoney(quote.amount, quote.currency)}</b> into escrow. The worker is paid
                          only when you approve the work.
                        </Small>
                        <Button small tone="primary" disabled={busyId !== null} onClick={() => void choose(a.workerId)}>
                          {busyId === a.workerId ? 'Choosing…' : `Choose ${a.worker.name}`}
                        </Button>
                      </div>
                    )}
                  </Card>
                )
              })}
            </>
          )
        }
      </Async>
    </Page>
  )
}
