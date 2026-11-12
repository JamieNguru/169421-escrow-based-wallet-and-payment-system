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
  wallet_topup: 'Top-up from M-Pesa',
  escrow_fund: 'Payment held in escrow',
  escrow_release: 'Payment released',
  escrow_refund: 'Payment refunded',
  withdrawal: 'Withdrawal to M-Pesa',
  withdrawal_reversal: 'Withdrawal returned to wallet',
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  wallet_topup: { label: 'Added', tone: 'green' },
  escrow_fund: { label: 'Held', tone: 'amber' },
  escrow_release: { label: 'Released', tone: 'green' },
  escrow_refund: { label: 'Refunded', tone: 'red' },
  withdrawal: { label: 'Requested', tone: 'amber' },
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

  // Which way the money moved in the signed-in user's wallet. Escrow rows that do not touch it
  // (a client's release, a worker's hold) get no sign, so one job is not counted twice.
  const direction = (t: Transaction): 'in' | 'out' | null => {
    if (t.type === 'escrow_fund') return t.fromUserId === user?.id ? 'out' : null
    if (t.type === 'escrow_release') return t.toUserId === user?.id ? 'in' : null
    return t.toUserId === user?.id ? 'in' : 'out'
  }
  const visible = rows.filter((t) => filter === 'all' || direction(t) === filter)

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
            const dir = direction(t)
            return (
              <tr key={t.id}>
                <Td>{formatDate(t.createdAt)}</Td>
                <Td>{WHAT[t.type] ?? t.type}</Td>
                <Td className={dir === 'in' ? 'font-bold text-brand-ink' : 'font-bold'}>
                  {dir === 'in' ? '+ ' : dir === 'out' ? '− ' : ''}
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
