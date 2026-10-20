import { jobsApi, walletApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Card, Empty, Label, LinkButton, Money, PageHead, SectionTitle, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

// The client's money at a glance, plus the jobs that need a payment or a release.
export default function ClientWallet() {
  const wallet = useAsync(walletApi.get)
  const jobs = useAsync(jobsApi.mine)

  return (
    <Page header={<PageHead title="Wallet" sub="Your money and the jobs it is held for" />}>
      <Async state={wallet}>
        {(w) => (
          <div className="grid gap-5 sm:grid-cols-2">
            <Card>
              <Label>Wallet balance</Label>
              <Money>{formatMoney(w.balance, w.currency)}</Money>
              <Small>Available to use</Small>
            </Card>
            <Card>
              <Label>Held in escrow</Label>
              <Money>{formatMoney(w.escrowBalance, w.currency)}</Money>
              <Small>Paid out only when you release it</Small>
            </Card>
          </div>
        )}
      </Async>

      <SectionTitle>Jobs that need you</SectionTitle>
      <Async state={jobs}>
        {(list) => {
          const todo = list.filter((j) => j.status === 'assigned' && (!j.escrowStatus || j.escrowStatus === 'pending' || j.escrowStatus === 'work_submitted'))
          if (todo.length === 0) return <Empty>Nothing to pay or release right now.</Empty>
          return (
            <div className="grid gap-5 md:grid-cols-3">
              {todo.map((job) =>
                job.escrowStatus === 'work_submitted' ? (
                  <Card key={job.id}>
                    <div className="text-[17px] font-bold">{job.title}</div>
                    <Small className="mb-4 mt-1">Work is done · {formatMoney(job.budget, job.currency)}</Small>
                    <div className="flex-1" />
                    <LinkButton to={`/client/jobs/${job.id}/release`} small tone="primary">Check &amp; pay worker</LinkButton>
                  </Card>
                ) : (
                  <Card key={job.id}>
                    <div className="text-[17px] font-bold">{job.title}</div>
                    <Small className="mb-4 mt-1">Worker: {job.counterpartyName ?? 'chosen'} · {formatMoney(job.budget, job.currency)}</Small>
                    <div className="flex-1" />
                    <LinkButton to={`/client/jobs/${job.id}/pay`} small tone="primary">Pay into escrow</LinkButton>
                  </Card>
                ),
              )}
            </div>
          )
        }}
      </Async>
    </Page>
  )
}
