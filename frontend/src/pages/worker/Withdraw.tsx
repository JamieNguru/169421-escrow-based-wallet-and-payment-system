import { useState } from 'react'

import { paymentsApi, transactionsApi, walletApi } from '../../api/api'
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
  const history = useAsync(() => transactionsApi.list().then((r) => r.transactions.filter((t) => t.type === 'withdrawal').slice(0, 3)))
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

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
      <div className="grid gap-4 md:grid-cols-5">
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
                rows.map((t, i) => (
                  <div key={t.id} className={`flex items-center justify-between py-3 ${i ? 'border-t border-line' : ''}`}>
                    <div>
                      <div className="text-[15px] font-bold">{formatMoney(t.amount, t.currency)}</div>
                      <Small>{formatDate(t.createdAt)}</Small>
                    </div>
                    <Chip>Sent</Chip>
                  </div>
                ))
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
