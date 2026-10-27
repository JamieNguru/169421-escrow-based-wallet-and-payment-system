import type { MyKyc } from '../../api/types'
import { Card, IconBubble, Label, LinkButton, Small } from '../../components/ui'
import { formatDate } from '../../lib/format'

// Where the worker stands on identity verification: not started, verified or rejected.
// Checks run on submit, so there is no waiting state.
export default function KycCard({ kyc }: { kyc: MyKyc | null }) {
  const verified = kyc?.status === 'verified'
  return (
    <Card>
      <div className="flex items-center gap-3">
        <IconBubble name={verified ? 'check' : 'lock'} tone={verified ? 'green' : kyc ? 'red' : 'amber'} />
        <Label>Identity verification</Label>
      </div>
      {verified ? (
        <Small className="mt-3">Verified{kyc.verifiedAt ? ` on ${formatDate(kyc.verifiedAt)}` : ''}. You can apply for jobs.</Small>
      ) : kyc ? (
        <>
          <Small className="mt-3">Your last attempt was not accepted. Check what to fix and try again.</Small>
          <LinkButton to="/worker/verification" small tone="primary" className="mt-3">Try again</LinkButton>
        </>
      ) : (
        <>
          <Small className="mt-3">Verify your identity to apply for jobs.</Small>
          <LinkButton to="/worker/verification" small tone="primary" className="mt-3">Start verification</LinkButton>
        </>
      )}
    </Card>
  )
}
