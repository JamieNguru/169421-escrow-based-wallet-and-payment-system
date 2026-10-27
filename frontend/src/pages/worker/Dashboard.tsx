import { useState } from 'react'
import { Link } from 'react-router-dom'

import { escrowApi, jobsApi, kycApi, trustApi, walletApi } from '../../api/api'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import Icon from '../../components/Icon'
import { Async, Button, Card, Empty, ErrorNote, Greeting, HeroCard, IconBubble, Label, LinkButton, Money, SectionTitle, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { firstName, formatJobPrice, formatMoney } from '../../lib/format'
import JobTile from './JobTile'
import KycCard from './KycCard'

export default function WorkerDashboard() {
  const { user } = useAuth()
  const wallet = useAsync(walletApi.get)
  const mine = useAsync(jobsApi.mine)
  const trust = useAsync(trustApi.me)
  const kyc = useAsync(kycApi.me)
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
        <Greeting
          name={user ? firstName(user.name) : ''}
          badge={trust.data && <TrustBadge level={trust.data.trustLevel} />}
        />
      }
    >
      <div className="grid gap-5 md:grid-cols-3">
        <HeroCard>
          <Label>Money you can withdraw</Label>
          <Async state={wallet}>{(w) => <Money size="text-4xl">{formatMoney(w.balance, w.currency)}</Money>}</Async>
          <div className="flex-1" />
          <LinkButton to="/worker/wallet" small tone="primary" icon="phone" className="mt-4">Withdraw to M-Pesa</LinkButton>
        </HeroCard>

        <Card>
          <div className="flex items-center gap-3">
            <IconBubble name="briefcase" />
            <Label>Your current job</Label>
          </div>
          <Async state={mine}>
            {(jobs) => {
              const current = jobs.find((j) => j.escrowStatus === 'in_escrow' || j.escrowStatus === 'work_submitted')
              if (!current) return <Small className="mt-3">No job in progress. Apply for one below.</Small>
              return (
                <>
                  <div className="mt-3 text-[17px] font-bold">{current.title}</div>
                  <Small className="mt-1">{formatJobPrice(current)} is held safely for you</Small>
                  <div className="flex-1" />
                  {current.escrowStatus === 'in_escrow' ? (
                    <Button small icon="check" className="mt-4" disabled={busy} onClick={() => void finish(current.id)}>
                      {busy ? 'Saving…' : 'I have finished'}
                    </Button>
                  ) : (
                    <Small className="mt-4 font-bold text-brand-ink">Waiting for the client to check your work</Small>
                  )}
                </>
              )
            }}
          </Async>
          {error && <div className="mt-2"><ErrorNote message={error} /></div>}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <IconBubble name="shield" />
            <Label>Your trust level</Label>
          </div>
          <div className="mt-3">{trust.data ? <TrustBadge level={trust.data.trustLevel} /> : <Small>…</Small>}</div>
          <Small className="mt-2.5">Finish jobs on time and avoid disputes to keep it high.</Small>
          <div className="flex-1" />
          <Link to="/worker/trust" className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-brand-ink hover:underline">
            See why <Icon name="arrow" size={16} />
          </Link>
        </Card>
      </div>

      {kyc.data !== undefined && <KycCard kyc={kyc.data} />}

      <SectionTitle>New jobs</SectionTitle>
      <Async state={browse}>
        {(jobs) =>
          jobs.length === 0 ? (
            <Empty icon="search">No open jobs right now. Check back soon.</Empty>
          ) : (
            <div className="grid gap-5 md:grid-cols-3">
              {jobs.map((job) => (
                <JobTile key={job.id} job={job} verified={kyc.data?.status === 'verified'} />
              ))}
            </div>
          )
        }
      </Async>
    </Page>
  )
}
