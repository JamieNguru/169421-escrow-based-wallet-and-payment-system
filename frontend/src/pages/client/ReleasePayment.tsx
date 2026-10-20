import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { escrowApi } from '../../api/api'
import type { Escrow } from '../../api/types'
import { Page } from '../../components/AppShell'
import Icon from '../../components/Icon'
import { Async, Button, Card, Chip, ErrorNote, Label, Money, PageHead, SectionTitle } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDateTime, formatMoney } from '../../lib/format'

const STEPS = ['Paid', 'Held safely', 'Work done', 'Released']

const stepsDone = (escrow: Escrow) => {
  if (escrow.status === 'completed' || escrow.status === 'split') return 4
  if (escrow.status === 'work_submitted') return 3
  return 2
}

function Steps({ done }: { done: number }) {
  return (
    <div className="relative flex">
      <div className="absolute left-[12%] right-[12%] top-[15px] h-0.5 bg-brand" />
      {STEPS.map((label, i) => (
        <div key={label} className="z-[1] flex flex-1 flex-col items-center gap-1.5">
          <div className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-brand text-white ${i < done ? 'bg-brand' : 'bg-white'}`}>
            {i < done && <Icon name="check" size={18} />}
          </div>
          <div className={`text-center text-[13px] ${i < done ? 'font-bold' : 'text-neutral-400'}`}>{label}</div>
        </div>
      ))}
    </div>
  )
}

// Check the finished work and release the escrow (wireframe 07).
export default function ReleasePayment() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const state = useAsync(() => escrowApi.get(jobId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = async () => {
    setBusy(true)
    setError(null)
    try {
      await escrowApi.confirm(jobId)
      navigate('/client')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not release the payment')
      setBusy(false)
    }
  }

  return (
    <Page header={<PageHead title="Release payment" sub="Check the work, then pay your worker" />}>
      <Async state={state}>
        {(escrow) => {
          const canRelease = escrow.status === 'work_submitted'
          const activity = [
            { what: `You paid ${formatMoney(escrow.amount, escrow.currency)} from M-Pesa`, when: escrow.fundedAt },
            { what: 'Money is being held safely until the job is done', when: escrow.fundedAt },
            escrow.workSubmittedAt && { what: 'The worker marked the work as done', when: escrow.workSubmittedAt },
            escrow.completedAt && { what: 'You released the payment', when: escrow.completedAt },
            escrow.disputedAt && { what: 'A problem was reported. An admin will decide', when: escrow.disputedAt },
          ].filter((row): row is { what: string; when: string } => Boolean(row))

          return (
            <>
              <div className="grid gap-5 md:grid-cols-5">
                <Card className="md:col-span-3">
                  <div>
                    <Chip icon="lock">{escrow.status === 'completed' ? 'Released' : escrow.status === 'split' ? 'Split by admin' : 'Held safely'}</Chip>
                  </div>
                  <Money size="text-[44px]">{formatMoney(escrow.amount, escrow.currency)}</Money>
                  <div className="mt-7">
                    <Steps done={stepsDone(escrow)} />
                  </div>
                </Card>
                <Card className="md:col-span-2">
                  <Label>What to do next</Label>
                  <div className="mt-2 text-base leading-normal text-neutral-800">
                    {canRelease
                      ? 'The worker says the work is done. Check the work, then release the money. It goes straight to their wallet.'
                      : escrow.status === 'in_escrow'
                        ? 'Waiting for the worker to finish. You will be able to release the money once they mark the work as done.'
                        : 'Nothing more to do for this job.'}
                  </div>
                  <div className="flex-1" />
                  {error && <div className="mt-4"><ErrorNote message={error} /></div>}
                  {canRelease && (
                    <>
                      <Button tone="primary" icon="check" className="mt-4" disabled={busy} onClick={() => void release()}>
                        {busy ? 'Releasing…' : `Release ${formatMoney(escrow.amount, escrow.currency)}`}
                      </Button>
                      <Link to={`/client/jobs/${jobId}/report`} className="mt-3 flex h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-danger text-[17px] font-bold text-danger hover:bg-danger-tint">
                        <Icon name="alert" size={20} />
                        Report a problem
                      </Link>
                    </>
                  )}
                </Card>
              </div>

              <SectionTitle>Payment activity</SectionTitle>
              <Card className="px-4 py-1.5">
                {activity.map((row, i) => (
                  <div key={row.what} className={`flex items-center justify-between py-[11px] ${i ? 'border-t border-line' : ''}`}>
                    <div className="text-[15px]">{row.what}</div>
                    <div className="text-sm text-neutral-600">{formatDateTime(row.when)}</div>
                  </div>
                ))}
              </Card>
            </>
          )
        }}
      </Async>
    </Page>
  )
}
