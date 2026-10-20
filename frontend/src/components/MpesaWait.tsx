import { useEffect, useRef, useState } from 'react'

import { paymentsApi } from '../api/api'
import type { Payment } from '../api/types'
import { Banner, Button, ErrorNote } from './ui'

const POLL_MS = 2500
const GIVE_UP_MS = 3 * 60 * 1000

// Shown while an M-Pesa prompt is open: waits for the payment to settle, then
// tells the page the result. In the server's test mode no real prompt is sent,
// so it offers buttons that settle the payment instead.
export default function MpesaWait({
  payment,
  message,
  onSettled,
}: {
  payment: Payment
  message?: string
  onSettled: (payment: Payment) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Held in a ref so a new onSettled from the parent never restarts the polling.
  const settled = useRef(onSettled)
  settled.current = onSettled

  useEffect(() => {
    let stopped = false
    const startedAt = Date.now()
    const timer = setInterval(() => {
      paymentsApi
        .get(payment.checkoutRequestId)
        .then((latest) => {
          if (stopped || latest.status === 'pending') return
          stopped = true
          clearInterval(timer)
          settled.current(latest)
        })
        .catch(() => {
          // A dropped request is fine; the next poll tries again.
        })
      if (!stopped && Date.now() - startedAt > GIVE_UP_MS) {
        stopped = true
        clearInterval(timer)
        settled.current({
          ...payment,
          status: 'failed',
          failureReason: 'We did not get a confirmation from M-Pesa. If you were charged, check History in a minute.',
        })
      }
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [payment])

  const simulate = async (outcome: 'success' | 'failure') => {
    setBusy(true)
    setError(null)
    try {
      const latest = await paymentsApi.simulate(payment.checkoutRequestId, outcome)
      settled.current(latest)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not simulate the payment')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {payment.simulated ? (
        <Banner tone="amber" icon="phone" title="Test mode: no real M-Pesa prompt was sent">
          <div className="mb-3">Choose what the payment should do, as if you had answered the prompt on your phone.</div>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button small tone="primary" disabled={busy} onClick={() => void simulate('success')}>
              Simulate a successful payment
            </Button>
            <Button small tone="danger" disabled={busy} onClick={() => void simulate('failure')}>
              Simulate a cancelled payment
            </Button>
          </div>
        </Banner>
      ) : (
        <Banner tone="amber" icon="clock" title="Check your phone">
          {message || 'Enter your M-Pesa PIN on the pop-up to finish paying.'} This page updates by itself.
        </Banner>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  )
}
