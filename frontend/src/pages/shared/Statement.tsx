import { useState } from 'react'
import { Link } from 'react-router-dom'

import { walletApi } from '../../api/api'
import type { Statement as StatementData } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import { Async, Banner, Button, Card, Label, PageHead, Select, Small, Table, Td } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Kenyan time, like the statement itself.
const thisYear = () => new Date(Date.now() + 3 * 3_600_000).getUTCFullYear()

const COLUMNS = {
  worker: [
    { key: 'received', label: 'Earned' },
    { key: 'withdrawn', label: 'Withdrawn' },
  ],
  client: [
    { key: 'paid', label: 'Paid into escrow' },
    { key: 'refunded', label: 'Refunded' },
  ],
} as const

function toCsv(statement: StatementData): string {
  const cols = COLUMNS[statement.role]
  const rows = [
    ['Month', 'Jobs', ...cols.map((c) => `${c.label} (KES)`)],
    ...statement.months.map((m) => [MONTHS[m.month - 1], m.jobs, ...cols.map((c) => m[c.key] ?? 0)]),
    ['Total', statement.totals.jobs, ...cols.map((c) => statement.totals[c.key] ?? 0)],
  ]
  return rows.map((row) => row.join(',')).join('\n')
}

function download(statement: StatementData) {
  const url = URL.createObjectURL(new Blob([toCsv(statement)], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `statement-${statement.year}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// A year of earnings (workers) or payments (clients), month by month, from the ledger.
// Meant to help with declaring income: the platform keeps the record, the user files the tax.
export default function Statement() {
  const { user } = useAuth()
  const role = user?.role === 'worker' ? 'worker' : 'client'
  const [year, setYear] = useState(thisYear())
  const state = useAsync(() => walletApi.statement(year), [year])
  const cols = COLUMNS[role]

  return (
    <Page
      header={
        <PageHead
          title={role === 'worker' ? 'Earnings statement' : 'Payments statement'}
          sub={role === 'worker' ? 'What you earned and withdrew, for your tax records' : 'What you paid and got back, for your records'}
          right={
            <div className="w-28">
              <Select label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[0, 1, 2].map((back) => (
                  <option key={back} value={thisYear() - back}>
                    {thisYear() - back}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
      }
    >
      <Async state={state}>
        {(s) => (
          <>
            <div className="grid gap-5 sm:grid-cols-3">
              <Card>
                <Label>{cols[0].label} in {s.year}</Label>
                <div className="mt-1 text-3xl font-extrabold">{formatMoney(s.totals[cols[0].key] ?? 0, s.currency)}</div>
                <Small>across {s.totals.jobs} {s.totals.jobs === 1 ? 'job' : 'jobs'}</Small>
              </Card>
              <Card>
                <Label>{cols[1].label}</Label>
                <div className="mt-1 text-3xl font-extrabold">{formatMoney(s.totals[cols[1].key] ?? 0, s.currency)}</div>
              </Card>
              {s.tax && (
                <Card>
                  <Label>Tax PIN</Label>
                  <div className="mt-1 text-3xl font-extrabold">{s.tax.taxPin ?? 'Not added'}</div>
                  <Small>
                    {s.tax.taxPin ? (
                      'On file with your verification'
                    ) : (
                      <>
                        You can withdraw up to {formatMoney(s.tax.thresholdKes, s.currency)} a year without one.{' '}
                        <Link to="/worker/verification" className="font-bold text-brand-ink">Add it</Link>
                      </>
                    )}
                  </Small>
                </Card>
              )}
            </div>

            <Table headers={['Month', 'Jobs', ...cols.map((c) => c.label)]}>
              {s.months.map((m) => (
                <tr key={m.month}>
                  <Td>{MONTHS[m.month - 1]}</Td>
                  <Td>{m.jobs}</Td>
                  {cols.map((c) => (
                    <Td key={c.key}>{formatMoney(m[c.key] ?? 0, s.currency)}</Td>
                  ))}
                </tr>
              ))}
              <tr className="font-bold">
                <Td>Total</Td>
                <Td>{s.totals.jobs}</Td>
                {cols.map((c) => (
                  <Td key={c.key}>{formatMoney(s.totals[c.key] ?? 0, s.currency)}</Td>
                ))}
              </tr>
            </Table>

            <div className="flex flex-wrap gap-3">
              <Button small tone="primary" className="w-auto px-5" onClick={() => download(s)}>Download CSV</Button>
              <Button small className="w-auto px-5" onClick={() => window.print()}>Print</Button>
            </div>
            <Banner icon="shield" title="Your tax is your responsibility">
              This statement lists what went through the platform so you have a record. Declaring income and paying any
              tax due is up to you, and the platform may be required to share records with the tax authority.
            </Banner>
          </>
        )}
      </Async>
    </Page>
  )
}
