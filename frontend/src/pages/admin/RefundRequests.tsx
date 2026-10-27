import { useState } from 'react'

import { adminApi, escrowApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Button, Card, Chip, Empty, ErrorNote, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { ageLabel, formatMoney } from '../../lib/format'

type Filter = 'pending' | 'approved'

// Refund requests from clients; approving one returns the escrowed money to the client.
export default function RefundRequests() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const state = useAsync(() => adminApi.refundRequests(filter), [filter])

  const approve = async (jobId: string) => {
    setBusyId(jobId)
    setError(null)
    try {
      await escrowApi.processRefund(jobId)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process this refund')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Page header={<PageHead title="Refund requests" sub="Clients asking for their held money back" />}>
      <div className="flex gap-2">
        <Chip tone={filter === 'pending' ? 'solid' : 'grey'} onClick={() => setFilter('pending')}>Pending</Chip>
        <Chip tone={filter === 'approved' ? 'solid' : 'grey'} onClick={() => setFilter('approved')}>Approved</Chip>
      </div>
      {error && <ErrorNote message={error} />}
      <Async state={state}>
        {(list) =>
          list.length === 0 ? (
            <Empty>No {filter} refund requests.</Empty>
          ) : (
            list.map((r) => (
              <Card key={r.jobId} className="flex-row items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[17px] font-bold">{r.jobTitle ?? 'Job'} · {formatMoney(r.amount, r.currency)}</div>
                  <Small className="mt-0.5">{r.clientName ?? 'Client'} (client) · {r.workerName ?? 'Worker'} (worker)</Small>
                  <Small>“{r.reason}”</Small>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {r.status === 'pending' ? (
                    <>
                      <Chip tone="amber">{ageLabel(r.createdAt)}</Chip>
                      <Button small className="w-[130px]" disabled={busyId === r.jobId} onClick={() => void approve(r.jobId)}>
                        {busyId === r.jobId ? 'Refunding…' : 'Refund client'}
                      </Button>
                    </>
                  ) : (
                    <Chip tone="grey">Refunded</Chip>
                  )}
                </div>
              </Card>
            ))
          )
        }
      </Async>
    </Page>
  )
}
