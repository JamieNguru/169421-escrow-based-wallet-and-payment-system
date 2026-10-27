import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { escrowApi, jobsApi, paymentsApi, walletApi } from '../../api/api'
import type { Conversion, Payment } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import MpesaWait from '../../components/MpesaWait'
import { Async, Banner, Button, Card, ErrorNote, Field, Label, Money, PageHead, Select, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney, jobPrice } from '../../lib/format'

const OTHERS = ['UGX', 'TZS', 'USD'] as const

type Method = 'wallet' | 'mpesa'

// Pay into escrow, from the wallet when it has enough or with an M-Pesa prompt
// (wireframe 06). The price is the quote agreed with the worker and is read-only:
// the server works out the amount to charge, in whole KES, so nothing is sent.
// A job priced in another currency is only converted here to show the figure.
export default function PayEscrow() {
  const { jobId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const jobs = useAsync(jobsApi.mine)
  const wallet = useAsync(walletApi.get)
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [kes, setKes] = useState<number | null>(null)
  const [quotes, setQuotes] = useState<Conversion[]>([])
  const [choice, setChoice] = useState<Method | null>(null)
  const [started, setStarted] = useState<{ payment: Payment; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const job = jobs.data?.find((j) => j.id === jobId)

  useEffect(() => {
    if (!job) return
    let current = true
    const { amount, currency } = jobPrice(job)
    const targets = (['KES', ...OTHERS] as const).filter((c) => c !== currency)
    Promise.all(targets.map((to) => walletApi.convert(currency, to, amount)))
      .then((all) => {
        if (!current) return
        setQuotes(all)
        const toKes = all.find((q) => q.to === 'KES')
        setKes(currency === 'KES' ? Math.ceil(amount) : toKes ? Math.ceil(toKes.converted) : null)
      })
      .catch(() => {
        if (current) setKes(currency === 'KES' ? Math.ceil(amount) : null)
      })
    return () => {
      current = false
    }
  }, [job])

  const balance = wallet.data?.balance ?? 0
  const canUseWallet = kes !== null && balance >= kes
  // Use the wallet by default when it covers the job, until the client picks otherwise.
  const method: Method = choice ?? (canUseWallet ? 'wallet' : 'mpesa')

  const payFromWallet = async () => {
    if (!job?.workerId || kes === null) return
    setBusy(true)
    setError(null)
    try {
      await escrowApi.fund({ jobId, workerId: job.workerId })
      navigate('/client', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pay from your wallet')
      setBusy(false)
    }
  }

  const payWithMpesa = async () => {
    if (!job?.workerId || kes === null) return
    setBusy(true)
    setError(null)
    try {
      const { payment, message } = await paymentsApi.stkPush({
        jobId,
        workerId: job.workerId,
        phone: phone || undefined,
      })
      setStarted({ payment, message })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment')
    } finally {
      setBusy(false)
    }
  }

  const settled = (payment: Payment) => {
    if (payment.status === 'completed') {
      navigate('/client', { replace: true })
      return
    }
    setStarted(null)
    setError(payment.failureReason ?? 'The payment did not go through. You have not been charged.')
  }

  return (
    <Page
      header={<PageHead title="Pay into escrow" sub={job ? `${job.title} · Worker: ${job.counterpartyName ?? 'chosen'}` : undefined} />}
    >
      <Async state={jobs}>
        {() =>
          !job ? (
            <ErrorNote message="We could not find this job." />
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <Card>
                  <Label>Agreed price</Label>
                  <Money size="text-[40px]">{kes === null ? '…' : formatMoney(kes, 'KES')}</Money>
                  {quotes.length > 0 && (
                    <Small>
                      ≈ {quotes.filter((q) => q.to !== 'KES').map((q) => formatMoney(Math.round(q.converted), q.to)).join(' · ')}
                    </Small>
                  )}
                  <div className="mt-4">
                    <Banner icon="lock">The worker does not get this money until you say the work is done.</Banner>
                  </div>
                </Card>

                <Card className="gap-3.5">
                  <Select
                    label="Pay from"
                    value={method}
                    disabled={busy || started !== null}
                    onChange={(e) => setChoice(e.target.value as Method)}
                    hint={
                      wallet.data && kes !== null
                        ? canUseWallet
                          ? `Your wallet has ${formatMoney(balance, wallet.data.currency)}.`
                          : `Your wallet has ${formatMoney(balance, wallet.data.currency)}, which is not enough. M-Pesa adds the money and pays in one step.`
                        : undefined
                    }
                  >
                    <option value="wallet" disabled={!canUseWallet}>
                      Wallet{wallet.data ? ` (${formatMoney(balance, wallet.data.currency)})` : ''}
                    </option>
                    <option value="mpesa">M-Pesa</option>
                  </Select>

                  {method === 'mpesa' && (
                    <Field label="M-Pesa phone number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" disabled={busy || started !== null} />
                  )}
                  <div className="flex-1" />

                  {method === 'wallet' ? (
                    <Button tone="primary" icon="wallet" disabled={busy || !canUseWallet || !job.workerId} onClick={() => void payFromWallet()}>
                      {busy ? 'Paying…' : kes === null ? 'Pay from wallet' : `Pay ${formatMoney(kes, 'KES')} from wallet`}
                    </Button>
                  ) : (
                    <Button tone="primary" icon="phone" disabled={busy || started !== null || kes === null || !job.workerId} onClick={() => void payWithMpesa()}>
                      {kes === null ? 'Pay with M-Pesa' : `Pay ${formatMoney(kes, 'KES')} with M-Pesa`}
                    </Button>
                  )}
                  <Small className="text-center">
                    Want to add money first? <Link to="/client/wallet" className="font-bold text-brand-ink">Top up your wallet</Link>
                  </Small>
                </Card>
              </div>

              {error && <ErrorNote message={error} />}
              {started && <MpesaWait payment={started.payment} message={started.message} onSettled={settled} />}
            </>
          )
        }
      </Async>
    </Page>
  )
}
