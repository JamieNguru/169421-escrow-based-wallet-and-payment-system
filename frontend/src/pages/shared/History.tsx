import { useCallback, useEffect, useState } from 'react'

import { transactionsApi } from '../../api/api'
import type { Transaction } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Button, Chip, Empty, ErrorNote, Loading, PageHead, Table, Td } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/format'

type Filter = 'all' | 'in' | 'out'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
]

const WHAT: Record<string, string> = {
  escrow_fund: 'Payment held in escrow',
  escrow_release: 'Payment released',
  escrow_refund: 'Payment refunded',
  withdrawal: 'Withdrawal to M-Pesa',
  withdrawal_reversal: 'Withdrawal returned to wallet',
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  escrow_fund: { label: 'Held', tone: 'amber' },
  escrow_release: { label: 'Released', tone: 'green' },
  escrow_refund: { label: 'Refunded', tone: 'red' },
  withdrawal: { label: 'Sent', tone: 'green' },
  withdrawal_reversal: { label: 'Returned', tone: 'grey' },
}

// Ledger for the signed-in client or worker (wireframe 14).
export default function History() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Transaction[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async (next?: string) => {
    setLoading(true)
    setError(null)
    try {
      const page = await transactionsApi.list(next)
      setRows((current) => (next ? [...current, ...page.transactions] : page.transactions))
      setCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const incoming = (t: Transaction) => t.toUserId === user?.id
  const visible = rows.filter((t) => filter === 'all' || (filter === 'in') === incoming(t))

  return (
    <Page header={<PageHead title="History" sub="All money in and out of your wallet" />}>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.id} tone={filter === f.id ? 'solid' : 'grey'} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {error && <ErrorNote message={error} />}
      {!error && !loading && visible.length === 0 && <Empty>No transactions yet.</Empty>}

      {visible.length > 0 && (
        <Table headers={['Date', 'What happened', 'Amount', 'Status']}>
          {visible.map((t) => {
            const status = STATUS[t.type] ?? { label: t.type, tone: 'grey' as const }
            const isIn = incoming(t)
            return (
              <tr key={t.id}>
                <Td>{formatDate(t.createdAt)}</Td>
                <Td>{WHAT[t.type] ?? t.type}</Td>
                <Td className={isIn ? 'font-bold text-brand-ink' : 'font-bold'}>
                  {isIn ? '+ ' : '− '}
                  {formatMoney(t.amount, t.currency)}
                </Td>
                <Td>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </Td>
              </tr>
            )
          })}
        </Table>
      )}

      {loading && <Loading />}
      {cursor && !loading && (
        <Button small onClick={() => void load(cursor)} className="max-w-[200px] self-center">
          Load more
        </Button>
      )}
    </Page>
  )
}
