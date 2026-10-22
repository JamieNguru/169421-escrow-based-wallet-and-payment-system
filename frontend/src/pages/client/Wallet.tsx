import { useState } from 'react'

import { jobsApi, paymentsApi, walletApi } from '../../api/api'
import type { Payment } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import MpesaWait from '../../components/MpesaWait'
import { Async, Banner, Button, Card, Empty, ErrorNote, Field, IconBubble, Label, LinkButton, Money, PageHead, SectionTitle, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

const QUICK_AMOUNTS = [500, 1000, 5000]

// Add money to the wallet with an M-Pesa prompt, with no job involved.
function TopUp({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth()
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [started, setStarted] = useState<{ payment: Payment; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const { payment, message } = await paymentsApi.topUp({ amount: Number(amount), phone: phone || undefined })
      setStarted({ payment, message })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the top-up')
    } finally {
      setBusy(false)
    }
  }

  const settled = (payment: Payment) => {
    setStarted(null)
    if (payment.status === 'completed') {
      setAdded(payment.amount)
      setAmount('')
      onAdded()
    } else {
      setError(payment.failureReason ?? 'The top-up did not go through. You have not been charged.')
    }
  }

  const waiting = started !== null
  const valid = Number.isInteger(Number(amount)) && Number(amount) > 0

  return (
    <Card className="gap-3.5">
      <div className="flex items-center gap-3">
        <IconBubble name="plus" />
        <div>
          <div className="text-lg font-bold">Top up your wallet</div>
          <Small>Add money with M-Pesa, then pay for jobs straight from your wallet.</Small>
        </div>
      </div>
      <div className="flex flex-col gap-3.5 sm:flex-row">
        <Field label="Amount (whole KES)" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy || waiting} placeholder="1000" />
        <Field label="M-Pesa phone number" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy || waiting} placeholder="0712 345 678" />
      </div>
      <div className="flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy || waiting}
            onClick={() => setAmount(String(n))}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-neutral-600 transition hover:border-brand hover:text-brand-ink disabled:opacity-50"
          >
            {formatMoney(n, 'KES')}
          </button>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      {added !== null && <Banner icon="check" title={`${formatMoney(added, 'KES')} added to your wallet`} />}
      {started && <MpesaWait payment={started.payment} message={started.message} onSettled={settled} />}
      <Button tone="primary" icon="phone" disabled={busy || waiting || !valid} onClick={() => void start()}>
        {busy ? 'Sending…' : valid ? `Top up ${formatMoney(Number(amount), 'KES')} with M-Pesa` : 'Top up with M-Pesa'}
      </Button>
    </Card>
  )
}

// The client's money at a glance, a top-up, plus the jobs that need a payment or a release.
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

      <TopUp onAdded={wallet.reload} />

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
