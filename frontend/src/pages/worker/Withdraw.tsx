import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { paymentsApi, walletApi } from '../../api/api'
import type { Withdrawal } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Async, Banner, Button, Card, Chip, ErrorNote, Field, Label, Money, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatMoney } from '../../lib/format'

// Withdraw earnings to M-Pesa (wireframe 12). The payout goes to the phone
// number the worker registered with.
export default function Withdraw() {
  const { user } = useAuth()
  const wallet = useAsync(walletApi.get)
  const history = useAsync(() => paymentsApi.withdrawals().then((rows) => rows.slice(0, 5)))
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  // A withdrawal stays "Processing" until M-Pesa reports back, so keep checking while one is open.
  const hasPending = history.data?.some((w) => w.status === 'pending') ?? false
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => {
      history.reload()
      wallet.reload()
    }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending])

  const withdraw = async () => {
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      const w = await paymentsApi.withdraw(Number(amount))
      setSent(`Sending ${formatMoney(w.amount, w.currency)} to your M-Pesa. It usually arrives within a few minutes.`)
      setAmount('')
      wallet.reload()
      history.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the withdrawal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page header={<PageHead title="Withdraw to M-Pesa" sub="Send your earnings to your phone" />}>
      <div className="grid gap-5 md:grid-cols-5">
        <Card className="gap-3.5 md:col-span-3">
          <Async state={wallet}>
            {(w) => (
              <>
                <div>
                  <Label>Money you can withdraw</Label>
                  <Money size="text-[40px]">{formatMoney(w.balance, w.currency)}</Money>
                  {w.escrowBalance > 0 && <Small>{formatMoney(w.escrowBalance, w.currency)} more is held safely for your current job</Small>}
                </div>
                <div className="flex flex-col gap-3.5 sm:flex-row">
                  <Field label="Amount (whole KES)" type="number" min={1} step={1} max={Math.floor(w.balance)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <Field label="M-Pesa phone number" value={user?.phone ?? ''} readOnly hint="We send to the number you registered with" />
                </div>
                {error && <ErrorNote message={error} />}
                {error && /tax PIN/i.test(error) && (
                  <Link to="/worker/verification" className="text-sm font-bold text-brand-ink hover:underline">Add your tax PIN</Link>
                )}
                {sent && <Banner icon="check">{sent}</Banner>}
                <div className="flex-1" />
                <Button tone="primary" icon="phone" disabled={busy || !Number(amount)} onClick={() => void withdraw()}>
                  {busy ? 'Sending…' : Number(amount) ? `Withdraw ${formatMoney(Number(amount), 'KES')}` : 'Withdraw'}
                </Button>
              </>
            )}
          </Async>
        </Card>

        <Card className="md:col-span-2">
          <Label>Recent withdrawals</Label>
          <Async state={history}>
            {(rows) =>
              rows.length === 0 ? (
                <Small className="mt-3">No withdrawals yet.</Small>
              ) : (
                rows.map((t, i) => <WithdrawalRow key={t.id} w={t} first={i === 0} />)
              )
            }
          </Async>
          <div className="flex-1" />
          <Small className="mt-3">Money usually arrives in your M-Pesa within a few minutes.</Small>
        </Card>
      </div>
    </Page>
  )
}

const STATUS: Record<Withdrawal['status'], { label: string; tone: 'amber' | 'green' | 'red' }> = {
  pending: { label: 'Processing', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
}

function WithdrawalRow({ w, first }: { w: Withdrawal; first: boolean }) {
  const status = STATUS[w.status]
  return (
    <div className={`py-3 ${first ? '' : 'border-t border-line'}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-bold">{formatMoney(w.amount, w.currency)}</div>
          <Small>{formatDate(w.createdAt)}</Small>
        </div>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>
      {w.status === 'completed' && w.receipt && <Small className="mt-1">M-Pesa receipt {w.receipt}</Small>}
      {w.status === 'failed' && <Small className="mt-1">{w.failureReason ?? 'The payout failed'}. The money is back in your wallet.</Small>}
    </div>
  )
}
