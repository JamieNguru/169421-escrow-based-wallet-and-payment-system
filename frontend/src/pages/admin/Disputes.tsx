import { useState } from 'react'

import { adminApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Card, Chip, Empty, LinkButton, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { ageLabel, formatMoney } from '../../lib/format'

type Filter = 'open' | 'resolved'

// Dispute queue; Review opens the resolve screen (wireframe 16).
export default function Disputes() {
  const [filter, setFilter] = useState<Filter>('open')
  const state = useAsync(() => adminApi.disputes(filter), [filter])

  return (
    <Page header={<PageHead title="Disputes" sub="Money held until you decide" />}>
      <div className="flex gap-2">
        <Chip tone={filter === 'open' ? 'solid' : 'grey'} onClick={() => setFilter('open')}>Open</Chip>
        <Chip tone={filter === 'resolved' ? 'solid' : 'grey'} onClick={() => setFilter('resolved')}>Resolved</Chip>
      </div>
      <Async state={state}>
        {(list) =>
          list.length === 0 ? (
            <Empty>No {filter} disputes.</Empty>
          ) : (
            list.map((d) => (
              <Card key={d.jobId} className="flex-row items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[17px] font-bold">{d.jobTitle ?? 'Job'} · {formatMoney(d.amount, d.currency)}</div>
                  <Small className="mt-0.5">{d.clientName ?? 'Client'} (client) vs {d.workerName ?? 'Worker'} (worker)</Small>
                  <Small>“{d.reason}”</Small>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {d.status === 'open' ? <Chip tone="amber">{ageLabel(d.createdAt)}</Chip> : <Chip tone="grey">{d.decision === 'release' ? 'Paid worker' : d.decision === 'split' ? 'Split' : 'Refunded client'}</Chip>}
                  <LinkButton to={`/admin/disputes/${d.jobId}`} small tone={d.status === 'open' ? 'primary' : 'outline'} className="w-[110px]">
                    {d.status === 'open' ? 'Review' : 'View'}
                  </LinkButton>
                </div>
              </Card>
            ))
          )
        }
      </Async>
    </Page>
  )
}
