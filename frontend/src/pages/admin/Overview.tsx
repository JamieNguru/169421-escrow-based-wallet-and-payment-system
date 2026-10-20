import { useState } from 'react'
import { Link } from 'react-router-dom'

import { adminApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Card, Chip, Empty, Label, LinkButton, Money, PageHead, Small, TrustBadge } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { ageLabel, amountsLabel, formatMoney } from '../../lib/format'

function Kpi({ label, value, note, danger }: { label: string; value: string; note: string; danger?: boolean }) {
  return (
    <Card>
      <Label>{label}</Label>
      <Money size="text-3xl">
        <span className={danger ? 'text-danger' : ''}>{value}</span>
      </Money>
      <Small>{note}</Small>
    </Card>
  )
}

// Platform snapshot for admins (wireframe 15).
export default function AdminOverview() {
  const overview = useAsync(adminApi.overview)
  const disputes = useAsync(() => adminApi.disputes('open'))

  const [today] = useState(() => new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'short' }))

  return (
    <Page header={<PageHead title="Overview" sub={`Today, ${today}`} />}>
      <Async state={overview}>
        {(o) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Money in escrow" value={amountsLabel(o.escrows.amounts.held)} note={`across ${(o.escrows.byStatus.in_escrow ?? 0) + (o.escrows.byStatus.work_submitted ?? 0) + (o.escrows.byStatus.disputed ?? 0)} jobs`} />
              <Kpi label="Open disputes" value={String(o.disputes.open)} note="need your decision" danger={o.disputes.open > 0} />
              <Kpi label="Payments today" value={String(o.activity.paymentsToday)} note={`${o.activity.failedPaymentsToday} failed`} />
              <Kpi label="Active users" value={String(o.activity.activeUsers)} note="clients and workers" />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <Label>Disputes needing action</Label>
                <Async state={disputes}>
                  {(list) =>
                    list.length === 0 ? (
                      <div className="mt-3"><Empty>No open disputes.</Empty></div>
                    ) : (
                      list.slice(0, 5).map((d) => (
                        <div key={d.jobId} className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                          <div className="min-w-0">
                            <div className="text-[17px] font-bold">{d.jobTitle ?? 'Job'} · {formatMoney(d.amount, d.currency)}</div>
                            <Small className="mt-0.5">{d.clientName ?? 'Client'} (client) vs {d.workerName ?? 'Worker'} (worker)</Small>
                            <Small className="truncate">“{d.reason}”</Small>
                          </div>
                          <div className="flex shrink-0 items-center gap-2.5">
                            <Chip tone="amber">{ageLabel(d.createdAt)}</Chip>
                            <LinkButton to={`/admin/disputes/${d.jobId}`} small tone="primary" className="w-[110px]">Review</LinkButton>
                          </div>
                        </div>
                      ))
                    )
                  }
                </Async>
              </Card>

              <Card className="lg:col-span-2">
                <Label>Low-trust users to watch</Label>
                {o.trust.lowTrustUsers.length === 0 ? (
                  <Small className="mt-3">Nobody is rated Low right now.</Small>
                ) : (
                  o.trust.lowTrustUsers.slice(0, 6).map((u, i) => (
                    <div key={u.id} className={`flex items-center justify-between py-[11px] ${i ? 'border-t border-line' : ''}`}>
                      <div>
                        <div className="text-[15px] font-bold">{u.name ?? u.id}</div>
                        <Small className="capitalize">{u.role}</Small>
                      </div>
                      <TrustBadge level="Low" />
                    </div>
                  ))
                )}
                <div className="flex-1" />
                <Small className="mt-2">Scores from the trust model. <Link to="/admin/users" className="font-bold text-brand">See all users</Link></Small>
              </Card>
            </div>
          </>
        )}
      </Async>
    </Page>
  )
}
