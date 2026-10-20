import { useState } from 'react'
import { Link } from 'react-router-dom'

import { escrowApi, jobsApi, trustApi, walletApi } from '../../api/api'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Async, Button, Card, Empty, ErrorNote, Label, LinkButton, Money, SectionTitle, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { firstName, formatMoney } from '../../lib/format'
import JobTile from './JobTile'

export default function WorkerDashboard() {
  const { user } = useAuth()
  const wallet = useAsync(walletApi.get)
  const mine = useAsync(jobsApi.mine)
  const trust = useAsync(trustApi.me)
  const browse = useAsync(() => jobsApi.browse().then((r) => r.jobs.slice(0, 3)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = async (jobId: string) => {
    setBusy(true)
    setError(null)
    try {
      await escrowApi.complete(jobId)
      mine.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark the job as done')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page
      header={
        <div>
          <h1 className="m-0 text-[22px] font-bold">Hi, {user ? firstName(user.name) : ''}</h1>
          <div className="mt-1.5 min-h-[30px]">{trust.data && <TrustBadge level={trust.data.trustLevel} />}</div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <Label>Money you can withdraw</Label>
          <Async state={wallet}>{(w) => <Money>{formatMoney(w.balance, w.currency)}</Money>}</Async>
          <div className="flex-1" />
          <LinkButton to="/worker/wallet" small tone="primary" icon="phone" className="mt-3">Withdraw to M-Pesa</LinkButton>
        </Card>

        <Card>
          <Label>Your current job</Label>
          <Async state={mine}>
            {(jobs) => {
              const current = jobs.find((j) => j.escrowStatus === 'in_escrow' || j.escrowStatus === 'work_submitted')
              if (!current) return <Small className="mt-1.5">No job in progress. Apply for one below.</Small>
              return (
                <>
                  <div className="mt-1.5 text-[17px] font-bold">{current.title}</div>
                  <Small className="mt-1">{formatMoney(current.budget, current.currency)} is held safely for you</Small>
                  <div className="flex-1" />
                  {current.escrowStatus === 'in_escrow' ? (
                    <Button small icon="check" className="mt-3" disabled={busy} onClick={() => void finish(current.id)}>
                      {busy ? 'Saving…' : 'I have finished'}
                    </Button>
                  ) : (
                    <Small className="mt-3 font-bold text-brand-dark">Waiting for the client to check your work</Small>
                  )}
                </>
              )
            }}
          </Async>
          {error && <div className="mt-2"><ErrorNote message={error} /></div>}
        </Card>

        <Card>
          <Label>Your trust level</Label>
          <div className="mt-2">{trust.data ? <TrustBadge level={trust.data.trustLevel} /> : <Small>…</Small>}</div>
          <Small className="mt-2.5">Finish jobs on time and avoid disputes to keep it high.</Small>
          <div className="flex-1" />
          <Link to="/worker/trust" className="mt-2.5 text-sm font-bold text-brand">See why →</Link>
        </Card>
      </div>

      <SectionTitle>New jobs</SectionTitle>
      <Async state={browse}>
        {(jobs) =>
          jobs.length === 0 ? (
            <Empty>No open jobs right now. Check back soon.</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {jobs.map((job) => (
                <JobTile key={job.id} job={job} />
              ))}
            </div>
          )
        }
      </Async>
    </Page>
  )
}
