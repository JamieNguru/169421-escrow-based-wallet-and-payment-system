import { jobsApi, trustApi, walletApi } from '../../api/api'
import type { MyJob } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Async, Card, Chip, Empty, Label, LinkButton, Money, SectionTitle, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { firstName, formatMoney } from '../../lib/format'

// What the client sees on a job card and what they can do next (wireframe 03).
function JobCard({ job }: { job: MyJob }) {
  let status: React.ReactNode
  let action: React.ReactNode = null
  let footer: React.ReactNode = null

  if (job.status === 'open') {
    const n = job.applicantCount ?? 0
    status = <Chip>{n === 0 ? 'No applicants yet' : `${n} ${n === 1 ? 'person' : 'people'} applied`}</Chip>
    if (n > 0) action = <LinkButton to={`/client/jobs/${job.id}/applicants`} small>Choose a worker</LinkButton>
  } else if (!job.escrowStatus || job.escrowStatus === 'pending') {
    status = <Chip tone="amber">Worker chosen</Chip>
    action = <LinkButton to={`/client/jobs/${job.id}/pay`} small tone="primary">Pay into escrow</LinkButton>
  } else if (job.escrowStatus === 'work_submitted') {
    status = <Chip tone="solid">Work is done</Chip>
    action = <LinkButton to={`/client/jobs/${job.id}/release`} small tone="primary">Check &amp; pay worker</LinkButton>
  } else if (job.escrowStatus === 'in_escrow') {
    status = <Chip tone="amber">In progress</Chip>
    footer = `Worker: ${job.counterpartyName ?? 'chosen'} · ${formatMoney(job.budget, job.currency)} held safely`
  } else if (job.escrowStatus === 'disputed') {
    status = <Chip tone="red">Under review</Chip>
    footer = 'An admin is looking at this job'
  } else if (job.escrowStatus === 'completed') {
    status = <Chip>Paid</Chip>
    footer = `Worker: ${job.counterpartyName ?? ''}`
  } else if (job.escrowStatus === 'split') {
    status = <Chip tone="grey">Settled by admin</Chip>
    footer = 'An admin split the payment between you and the worker'
  } else {
    status = <Chip tone="grey">Refunded</Chip>
  }

  return (
    <Card>
      <div className="text-[17px] font-bold">{job.title}</div>
      <div className="mt-1.5">{status}</div>
      <div className="mt-4 flex-1" />
      {action}
      {footer && <Small>{footer}</Small>}
    </Card>
  )
}

export default function ClientDashboard() {
  const { user } = useAuth()
  const wallet = useAsync(walletApi.get)
  const jobs = useAsync(jobsApi.mine)
  const trust = useAsync(trustApi.me)

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
        <Card className="md:col-span-2">
          <Label>Wallet balance</Label>
          <Async state={wallet}>
            {(w) => (
              <>
                <Money>{formatMoney(w.balance, w.currency)}</Money>
                <Small>{formatMoney(w.escrowBalance, w.currency)} held safely for your jobs</Small>
              </>
            )}
          </Async>
        </Card>
        <Card>
          <Label>Need help with something?</Label>
          <Small className="mb-3 mt-1.5">Describe the job and workers near you can apply.</Small>
          <div className="flex-1" />
          <LinkButton to="/client/post-job" tone="dark" icon="plus">Post a Job</LinkButton>
        </Card>
      </div>

      <SectionTitle>My jobs</SectionTitle>
      <Async state={jobs}>
        {(list) =>
          list.length === 0 ? (
            <Empty>You have not posted a job yet. Post one and workers can start applying.</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {list.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )
        }
      </Async>
    </Page>
  )
}
