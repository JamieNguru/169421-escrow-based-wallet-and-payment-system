import { Link } from 'react-router-dom'

import { adminApi } from '../../api/api'
import type { ComplianceFlag, FlagParty, FlagType } from '../../api/types'
import { Page } from '../../components/AppShell'
import { Async, Banner, Card, Chip, Empty, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatMoney } from '../../lib/format'

const TITLE: Record<FlagType, string> = {
  possible_splitting: 'Possible splitting',
  refund_after_delivery: 'Refunds after delivery',
  no_tax_pin: 'No tax PIN on file',
}

// A worker is not a user page of their own, so link to the user list for the name.
const who = (p: FlagParty) => p.name ?? `${p.role} ${p.id.slice(0, 6)}`

function Flag({ flag }: { flag: ComplianceFlag }) {
  return (
    <Card className="gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[17px] font-bold">{TITLE[flag.type]}</div>
        <Chip tone={flag.severity === 'high' ? 'red' : 'amber'}>{flag.severity === 'high' ? 'High' : 'Medium'}</Chip>
      </div>
      <div className="text-[15px]">
        <b>{who(flag.subject)}</b>
        {flag.counterparty && <> and <b>{who(flag.counterparty)}</b></>}
      </div>
      <Small>{flag.detail}</Small>
      <Small>
        {flag.jobCount} {flag.jobCount === 1 ? 'job' : 'jobs'} · {formatMoney(flag.amount, 'KES')}
      </Small>
    </Card>
  )
}

// Patterns an admin may want to look at. They are prompts to review, not proof of anything.
export default function Compliance() {
  const state = useAsync(adminApi.compliance)

  return (
    <Page header={<PageHead title="Compliance" sub="Patterns worth a closer look for tax and fraud" />}>
      <Banner icon="shield" title="Flags are prompts, not findings">
        Each one comes from a simple rule over the jobs and payments on the platform. Look at the history in{' '}
        <Link to="/admin/users" className="font-bold text-brand-ink">Users</Link> before drawing any conclusion.
      </Banner>
      <Async state={state}>
        {({ flags, thresholdKes }) => (
          <>
            <Small>
              Rules: five or more jobs under {formatMoney(10_000, 'KES')} between the same two people adding up to{' '}
              {formatMoney(50_000, 'KES')} or more within 14 days; two or more refunds after the work was delivered;
              earnings of {formatMoney(thresholdKes, 'KES')} or more this year with no tax PIN.
            </Small>
            {flags.length === 0 ? <Empty>Nothing is flagged right now.</Empty> : flags.map((f, i) => <Flag key={i} flag={f} />)}
          </>
        )}
      </Async>
    </Page>
  )
}
