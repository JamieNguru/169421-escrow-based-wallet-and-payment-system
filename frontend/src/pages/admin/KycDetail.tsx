import { useParams } from 'react-router-dom'

import { adminApi } from '../../api/api'
import { ID_TYPE_LABEL } from '../../api/types'
import { Page } from '../../components/AppShell'
import { PhotoGallery } from '../../components/Photos'
import { Async, Banner, Card, Chip, Label, PageHead, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/format'

// Full verification record for a disputed worker. Opening it is written to the access log.
export default function KycDetail() {
  const { workerId = '' } = useParams()
  const state = useAsync(() => adminApi.kyc(workerId), [workerId])

  return (
    <Page header={<PageHead title="Worker verification" sub="Sensitive personal data" />}>
      <Banner tone="amber" icon="lock">This view has been logged. Use it only to settle the dispute.</Banner>
      <Async state={state}>
        {(k) => {
          const rows: Array<[string, string]> = [
            ['Worker', k.workerName ?? k.workerId],
            ['Name on the ID', k.fullName],
            ['ID type', ID_TYPE_LABEL[k.idType]],
            ['ID number', k.idNumber],
            ['Date of birth', formatDate(k.dateOfBirth)],
            ['Consent given', k.consent ? 'Yes' : 'No'],
            ['Submitted', formatDate(k.submittedAt)],
          ]
          const photos = [k.images.front, k.images.back, k.images.selfie].filter((p): p is string => Boolean(p))
          return (
            <div className="grid gap-5 md:grid-cols-5">
              <Card className="gap-3 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Details</Label>
                  <Chip tone={k.status === 'verified' ? 'green' : 'red'}>{k.status === 'verified' ? 'Verified' : 'Rejected'}</Chip>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14.5px]">
                  {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                {k.reasons.length > 0 && <Small>Reasons: {k.reasons.join(' ')}</Small>}
              </Card>
              <Card className="gap-3 md:col-span-3">
                <Label>Photos (ID front, back, selfie)</Label>
                {photos.length > 0 ? <PhotoGallery photos={photos} /> : <Small>No photos on file.</Small>}
              </Card>
            </div>
          )
        }}
      </Async>
    </Page>
  )
}
