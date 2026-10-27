import { ID_TYPE_LABEL } from '../api/types'
import type { KycSummary as Summary } from '../api/types'
import { formatDate } from '../lib/format'
import { Chip, Small } from './ui'

// The few verified details a client may see: no photos and no full ID number.
export function KycDetails({ kyc }: { kyc: Summary }) {
  const rows: Array<[string, string]> = [
    ['Name on the ID', kyc.name],
    ['ID type', ID_TYPE_LABEL[kyc.idType]],
    ['ID number', kyc.idNumberMasked],
    ['Verified on', formatDate(kyc.verifiedAt)],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function VerifiedBadge() {
  return <Chip tone="green" icon="check">Verified</Chip>
}

export function NotVerified() {
  return <Small>Not verified</Small>
}
