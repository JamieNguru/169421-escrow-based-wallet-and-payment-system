import { adminApi } from '../../api/api'
import { ID_TYPE_LABEL } from '../../api/types'
import { Page } from '../../components/AppShell'
import { Async, Card, Chip, Empty, LinkButton, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/format'

// Only workers who are part of a dispute appear here.
export default function KycList() {
  const state = useAsync(adminApi.kycList)

  return (
    <Page header={<PageHead title="Worker KYC" sub="Only workers involved in a dispute" />}>
      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No workers are in a dispute.</Empty>
          ) : (
            rows.map((w) => (
              <Card key={w.workerId} className="flex-row items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[17px] font-bold">{w.workerName ?? 'Worker'}</div>
                  <Small className="mt-0.5">
                    {w.idType ? ID_TYPE_LABEL[w.idType] : 'No ID submitted'}
                    {w.verifiedAt && ` · verified ${formatDate(w.verifiedAt)}`}
                  </Small>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <Chip tone={w.status === 'verified' ? 'green' : w.status === 'rejected' ? 'red' : 'grey'}>
                    {w.status === 'not_submitted' ? 'Not submitted' : w.status === 'verified' ? 'Verified' : 'Rejected'}
                  </Chip>
                  {w.status !== 'not_submitted' && (
                    <LinkButton to={`/admin/kyc/${w.workerId}`} small tone="outline" className="w-[110px]">View</LinkButton>
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
