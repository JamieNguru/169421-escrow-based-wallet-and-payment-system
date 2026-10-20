import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { escrowApi, jobsApi, paymentsApi, walletApi } from '../../api/api'
import type { Conversion } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Async, Banner, Button, Card, ErrorNote, Field, Label, Money, PageHead, Select, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

const POLL_MS = 3000
const GIVE_UP_MS = 3 * 60 * 1000
const OTHERS = ['UGX', 'TZS', 'USD'] as const

// Pay into escrow with an M-Pesa STK push (wireframe 06). Payments are always
// in whole KES, so a job priced in another currency is converted first.
export default function PayEscrow() {
  const { jobId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const jobs = useAsync(jobsApi.mine)
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [kes, setKes] = useState<number | null>(null)
  const [quotes, setQuotes] = useState<Conversion[]>([])
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const job = jobs.data?.find((j) => j.id === jobId)

  useEffect(() => {
    if (!job) return
    let current = true
    const targets = (['KES', ...OTHERS] as const).filter((c) => c !== job.currency)
    Promise.all(targets.map((to) => walletApi.convert(job.currency, to, job.budget)))
      .then((all) => {
        if (!current) return
        setQuotes(all)
        const toKes = all.find((q) => q.to === 'KES')
        setKes(job.currency === 'KES' ? job.budget : toKes ? Math.ceil(toKes.converted) : null)
      })
      .catch(() => {
        if (current) setKes(job.currency === 'KES' ? job.budget : null)
      })
    return () => {
      current = false
    }
  }, [job])

  // After the prompt is sent, wait for the M-Pesa callback to fund the escrow.
  useEffect(() => {
    if (!waiting) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      escrowApi
        .get(jobId)
        .then((escrow) => {
          if (escrow.status !== 'pending') navigate('/client', { replace: true })
        })
        .catch(() => {
          // 404 until the callback lands; keep waiting.
        })
      if (Date.now() - startedAt > GIVE_UP_MS) {
        clearInterval(timer)
        setWaiting(false)
        setError('We did not get a confirmation from M-Pesa. If you were charged, check History in a minute.')
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, jobId, navigate])

  const pay = async () => {
    if (!job?.workerId || kes === null) return
    setBusy(true)
    setError(null)
    try {
      await paymentsApi.stkPush({ jobId, workerId: job.workerId, amount: kes, phone: phone || undefined })
      setWaiting(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment')
    } finally {
      setBusy(false)
    }
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
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <Label>You are paying</Label>
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
                  <Select label="Pay from" disabled>
                    <option>M-Pesa</option>
                  </Select>
                  <Field label="M-Pesa phone number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" disabled={waiting} />
                  <div className="flex-1" />
                  <Button tone="primary" icon="phone" disabled={busy || waiting || kes === null || !job.workerId} onClick={() => void pay()}>
                    {kes === null ? 'Pay with M-Pesa' : `Pay ${formatMoney(kes, 'KES')} with M-Pesa`}
                  </Button>
                </Card>
              </div>
              {error && <ErrorNote message={error} />}
              {waiting && (
                <Banner tone="amber" icon="clock" title="Check your phone">
                  Enter your M-Pesa PIN on the pop-up to finish paying. This page updates by itself.
                </Banner>
              )}
            </>
          )
        }
      </Async>
    </Page>
  )
}
