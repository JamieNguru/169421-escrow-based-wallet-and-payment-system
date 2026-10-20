import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { jobsApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Banner, Button, Card, Empty, ErrorNote, PageHead, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

// Applicants for one job (wireframe 05). Choosing one assigns the job, then the client pays.
export default function ChooseWorker() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const jobs = useAsync(jobsApi.mine)
  const applicants = useAsync(() => jobsApi.applications(jobId))
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

  return (
    <Page
      header={
        <PageHead
          title={job?.title ?? 'Choose a worker'}
          sub={job ? `${job.applicantCount ?? 0} applied · Budget ${formatMoney(job.budget, job.currency)}` : undefined}
        />
      }
    >
      <Banner icon="shield">
        <b>Trust level</b> is worked out from each worker’s history on the platform. You pay into escrow only after
        you choose.
      </Banner>
      {error && <ErrorNote message={error} />}
      <Async state={applicants}>
        {(list) =>
          list.length === 0 ? (
            <Empty>Nobody has applied yet.</Empty>
          ) : (
            list.map((a) => (
              <Card key={a.id} className="flex-row items-center justify-between gap-4 py-3.5">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-neutral-400 bg-neutral-300 font-bold text-neutral-700">
                    {a.worker.name.slice(0, 1)}
                  </div>
                  <div>
                    <div className="text-[17px] font-bold">{a.worker.name}</div>
                    <Small className="mt-0.5">{a.message || 'No message'}</Small>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {a.worker.trustLevel && <TrustBadge level={a.worker.trustLevel} />}
                <Button
                  small
                  tone={a.status === 'pending' ? 'outline' : 'primary'}
                  className="w-[120px] shrink-0"
                  disabled={busyId !== null || a.status !== 'pending'}
                  onClick={() => void choose(a.workerId)}
                >
                  {busyId === a.workerId ? 'Choosing…' : a.status === 'selected' ? 'Chosen' : 'Choose'}
                </Button>
                </div>
              </Card>
            ))
          )
        }
      </Async>
    </Page>
  )
}
