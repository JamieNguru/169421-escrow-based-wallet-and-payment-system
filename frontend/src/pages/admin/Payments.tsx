import { useState } from 'react'

import { adminApi } from '../../api/api'
import { Page } from '../../components/AppShell'
import { Async, Card, Chip, Empty, Label, Money, PageHead, Small, Table, Td } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { amountsLabel, formatDateTime, formatMoney, plural } from '../../lib/format'

const FILTERS = [
  { id: undefined, label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
] as const

const TONE: Record<string, 'green' | 'amber' | 'red'> = { completed: 'green', pending: 'amber', failed: 'red' }

// M-Pesa money in and out, with platform totals (wireframe 18).
export default function Payments() {
  const [status, setStatus] = useState<string | undefined>()
  const overview = useAsync(adminApi.overview)
  const state = useAsync(() => adminApi.payments(status), [status])

  return (
    <Page header={<PageHead title="Payments" sub="All M-Pesa and escrow activity" />}>
      <Async state={overview}>
        {(o) => (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <Label>Held in escrow</Label>
              <Money size="text-[26px]">{amountsLabel(o.escrows.amounts.held)}</Money>
              <Small>{plural(o.escrows.byStatus.in_escrow ?? 0, 'funded job')}</Small>
            </Card>
            <Card>
              <Label>Released</Label>
              <Money size="text-[26px]">{amountsLabel(o.escrows.amounts.released)}</Money>
              <Small>{plural(o.escrows.byStatus.completed ?? 0, 'job')} paid</Small>
            </Card>
            <Card>
              <Label>Refunded</Label>
              <Money size="text-[26px]">{amountsLabel(o.escrows.amounts.refunded)}</Money>
              <Small>{plural(o.escrows.byStatus.refunded ?? 0, 'refund')}</Small>
            </Card>
            <Card>
              <Label>Failed</Label>
              <Money size="text-[26px]">
                <span className={(o.payments.byStatus.failed ?? 0) + (o.withdrawals.byStatus.failed ?? 0) > 0 ? 'text-danger' : ''}>
                  {(o.payments.byStatus.failed ?? 0) + (o.withdrawals.byStatus.failed ?? 0)}
                </span>
              </Money>
              <Small>M-Pesa did not confirm</Small>
            </Card>
          </div>
        )}
      </Async>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.label} tone={status === f.id ? 'solid' : 'grey'} onClick={() => setStatus(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <Table headers={['Time', 'Type', 'Who', 'Amount', 'Status']}>
              {rows.map((p) => (
                <tr key={`${p.kind}-${p.id}`}>
                  <Td>{formatDateTime(p.createdAt)}</Td>
                  <Td>{p.kind === 'payment' ? 'Escrow payment' : 'Withdrawal'}</Td>
                  <Td>{p.userName ?? p.userId}</Td>
                  <Td className="font-bold">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>
                    <Chip tone={TONE[p.status] ?? 'grey'}>{p.status.charAt(0).toUpperCase() + p.status.slice(1)}</Chip>
                    {p.failureReason && <div className="mt-1 text-[13px] text-muted">{p.failureReason}</div>}
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }
      </Async>
    </Page>
  )
}
