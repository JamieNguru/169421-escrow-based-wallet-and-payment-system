import { trustApi } from '../../api/api'
import type { TrustLevel } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import Icon from '../../components/Icon'
import { Async, Card, Label, Money, PageHead, SectionTitle, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'

const TIPS = {
  client: [
    'Pay into escrow soon after choosing a worker',
    'Release the money quickly when the work is good',
    'Only report a problem when something really went wrong',
    'Reply to workers’ questions quickly',
  ],
  worker: [
    'Finish every job you accept',
    'Reply to clients quickly',
    'Mark work as done only when it is finished',
    'Solve problems with clients before they become disputes',
  ],
}

const LEVEL_COLOR: Record<TrustLevel, string> = {
  High: 'text-brand',
  Medium: 'text-warn',
  Low: 'text-danger',
}

// "My trust level" for clients and workers (wireframes 09 and 13): the model's
// verdict and how sure it is.
export default function Trust() {
  const { user } = useAuth()
  const role = user?.role === 'worker' ? 'worker' : 'client'
  const state = useAsync(trustApi.me)

  return (
    <Page
      header={
        <PageHead
          title="My trust level"
          sub={role === 'client' ? 'Workers see this before they apply for your jobs' : 'Clients see this when you apply for a job'}
        />
      }
    >
      <Async state={state}>
        {(score) => (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <Label>Your trust level</Label>
                <Money>
                  <span className={LEVEL_COLOR[score.trustLevel]}>{score.trustLevel}</span>
                </Money>
                <div className="mb-1.5 mt-2.5 flex gap-1.5">
                  <div className="h-2.5 flex-1 rounded-full bg-[#f3b0b0]" />
                  <div className="h-2.5 flex-1 rounded-full bg-[#f5c98a]" />
                  <div className="h-2.5 flex-1 rounded-full bg-brand" />
                </div>
                <div className="flex justify-between text-sm text-neutral-600">
                  <span>Low</span>
                  <span>Medium</span>
                  <span>High</span>
                </div>
                <Small className="mt-3.5">
                  Updated after every job. Worked out from your history on the platform, not from reviews alone.
                </Small>
              </Card>
              <Card>
                <Label>How to keep it high</Label>
                {TIPS[role].map((tip) => (
                  <div key={tip} className="mt-3 flex items-start gap-2.5 text-[15px]">
                    <span className="text-brand">
                      <Icon name="check" />
                    </span>
                    {tip}
                  </div>
                ))}
              </Card>
            </div>

            <SectionTitle>How sure the model is</SectionTitle>
            <div className="grid gap-5 sm:grid-cols-3">
              {(['High', 'Medium', 'Low'] as const).map((level) => (
                <Card key={level}>
                  <Label>{level} trust</Label>
                  <Money size="text-3xl">{Math.round((score.probabilities[level] ?? 0) * 100)}%</Money>
                  <Small>chance of this level</Small>
                </Card>
              ))}
            </div>
          </>
        )}
      </Async>
    </Page>
  )
}
