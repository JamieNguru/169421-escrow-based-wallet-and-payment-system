import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { adminApi, escrowApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Button, Card, ErrorNote, Label, PageHead, Small, TextArea } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatMoney } from '../../lib/format'

type Decision = 'release' | 'refund'

// Hear both sides and decide where the escrowed money goes (wireframe 16).
export default function ResolveDispute() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const state = useAsync(() => adminApi.disputes().then((all) => all.find((d) => d.jobId === jobId)))
  const [decision, setDecision] = useState<Decision>('refund')
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await escrowApi.resolveDispute(jobId, decision, resolution.trim())
      navigate('/admin/disputes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your decision')
      setBusy(false)
    }
  }

  return (
    <Page header={<PageHead title="Resolve dispute" sub="Both people will see your decision" />}>
      <Async state={state}>
        {(d) => {
          if (!d) return <ErrorNote message="We could not find this dispute." />
          const amount = formatMoney(d.amount, d.currency)
          const resolved = d.status === 'resolved'
          const options: Array<{ id: Decision; label: string }> = [
            { id: 'refund', label: `Refund the client (${amount})` },
            { id: 'release', label: `Pay the worker (${amount})` },
          ]

          return (
            <div className="grid gap-4 md:grid-cols-5">
              <Card className="md:col-span-3">
                <div className="text-[19px] font-bold">{d.jobTitle ?? 'Job'}</div>
                <Small className="mt-0.5">Opened {formatDate(d.createdAt)} · {amount} held in escrow</Small>
                <div className="mt-4 flex items-center justify-between">
                  <Label>{d.raisedByRole === 'client' ? 'Client says' : 'Worker says'}</Label>
                  <Small>{d.raisedByRole === 'client' ? d.clientName : d.workerName}</Small>
                </div>
                <div className="mt-2 text-[15px] leading-snug">“{d.reason}”</div>
                <Small className="mt-5 border-t border-line pt-3.5">
                  {d.raisedByRole === 'client' ? d.workerName : d.clientName} has not been asked to reply in the app yet.
                  Contact them by phone or email before you decide.
                </Small>
              </Card>

              <Card className="gap-3.5 md:col-span-2">
                <Label>Your decision</Label>
                {resolved ? (
                  <>
                    <div className="text-[17px] font-bold">{d.decision === 'release' ? 'Paid the worker' : 'Refunded the client'}</div>
                    <Small>{d.resolution}</Small>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-2.5" role="radiogroup">
                      {options.map((o) => {
                        const on = decision === o.id
                        return (
                          <button
                            key={o.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setDecision(o.id)}
                            className={`flex items-center gap-2.5 rounded-[10px] px-3.5 py-3 text-left text-[15px] ${on ? 'border-2 border-brand bg-brand-tint' : 'border-[1.5px] border-line'}`}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand">
                              {on && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                            </span>
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                    <TextArea label="Reason (both people will see this)" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} placeholder="The job was not fixed properly." />
                    {error && <ErrorNote message={error} />}
                    <div className="flex-1" />
                    <Button tone="primary" icon="check" disabled={busy || !resolution.trim()} onClick={() => void confirm()}>
                      {busy ? 'Saving…' : 'Confirm decision'}
                    </Button>
                  </>
                )}
              </Card>
            </div>
          )
        }}
      </Async>
    </Page>
  )
}
