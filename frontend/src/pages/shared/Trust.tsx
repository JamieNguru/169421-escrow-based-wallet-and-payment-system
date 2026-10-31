import { trustApi } from '../../api/api'
import type { TrustLevel } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Page } from '../../components/AppShell'
import Icon from '../../components/Icon'
import { Async, Card, Chip, Label, Money, PageHead, SectionTitle, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'

const TIPS = {
  client: [
    'Pay into escrow soon after choosing a worker',
    'Release the money quickly when the work is good',
    'Only report a problem when something really went wrong',
    'Reply to workers’ questions quickly',
  ],
  worker: [
    'Solve problems with clients before they become disputes',
    'Finish every job you accept',
    'Quote a delivery time you can keep, and deliver within it',
    'Mark work as done only when it is finished',
  ],
}

interface Factor {
  key: string
  label: string
  // 'rate' values are 0-1 shares; 'hours' are shown as is; 'overrun' is the share of the promised time a job ran over.
  unit: 'rate' | 'hours' | 'overrun'
  higherIsBetter: boolean
  // Guide values: at or beyond `good` is a strength, at or beyond `fair` is acceptable.
  good: number
  fair: number
  target: string
}

// What the model looks at, most important first: disputes count the most. The guide values are rough
// markers for the page, not the model's own cut-offs.
const FACTORS: Record<'client' | 'worker', Factor[]> = {
  worker: [
    { key: 'dispute_rate', label: 'Jobs disputed', unit: 'rate', higherIsBetter: false, good: 0.02, fair: 0.05, target: 'aim for under 2%' },
    { key: 'job_completion_rate', label: 'Jobs finished', unit: 'rate', higherIsBetter: true, good: 0.97, fair: 0.9, target: 'aim for 97% or more' },
    { key: 'delivery_overrun', label: 'Delivery vs your promised time', unit: 'overrun', higherIsBetter: false, good: 0.05, fair: 0.3, target: 'deliver within the time you quoted' },
  ],
  client: [
    { key: 'refund_rate', label: 'Refunds and disputes you raised', unit: 'rate', higherIsBetter: false, good: 0.02, fair: 0.05, target: 'aim for under 2%' },
    { key: 'payment_completion_rate', label: 'Jobs paid out', unit: 'rate', higherIsBetter: true, good: 0.97, fair: 0.9, target: 'aim for 97% or more' },
    { key: 'escrow_release_time_hours', label: 'Time to release payment', unit: 'hours', higherIsBetter: false, good: 8, fair: 24, target: 'aim for under 8 hours' },
  ],
}

const formatValue = (value: number, unit: Factor['unit']) => {
  if (unit === 'overrun') return value < 0.005 ? 'On time' : `${Math.round(value * 100)}% late`
  return unit === 'rate' ? `${Math.round(value * 1000) / 10}%` : `${Math.round(value * 10) / 10} h`
}

function standing(value: number, f: Factor): { tone: 'green' | 'amber' | 'red'; text: string } {
  const reaches = (limit: number) => (f.higherIsBetter ? value >= limit : value <= limit)
  if (reaches(f.good)) return { tone: 'green', text: 'Strong' }
  if (reaches(f.fair)) return { tone: 'amber', text: 'Fair' }
  return { tone: 'red', text: 'Needs work' }
}

// Spells out the inputs behind the level so the verdict is not a black box.
function WhyThisScore({ role, features, finishedJobs }: { role: 'client' | 'worker'; features: Record<string, number>; finishedJobs?: number }) {
  return (
    <>
      <SectionTitle>Why this score</SectionTitle>
      <Card>
        <Small>
          {finishedJobs ? `Based on your ${finishedJobs} finished jobs. ` : ''}
          The model compares three things, and disputes count the most.
        </Small>
        {FACTORS[role].map((f) => {
          const value = features[f.key]
          if (value === undefined) return null
          const { tone, text } = standing(value, f)
          return (
            <div key={f.key} className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
              <div>
                <div className="text-[15px] font-semibold">{f.label}</div>
                <Small>{f.target}</Small>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{formatValue(value, f.unit)}</span>
                <Chip tone={tone}>{text}</Chip>
              </div>
            </div>
          )
        })}
      </Card>
    </>
  )
}

const LEVEL_COLOR: Record<TrustLevel, string> = {
  New: 'text-neutral-600',
  High: 'text-brand-ink',
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
        {(score) =>
          score.trustLevel === 'New' ? (
            <NewMember finished={score.finishedJobs ?? 0} needed={score.jobsNeeded ?? 0} tips={TIPS[role]} />
          ) : (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <Label>Your trust level</Label>
                <Money>
                  <span className={LEVEL_COLOR[score.trustLevel]}>{score.trustLevel}</span>
                </Money>
                <div className="mb-1.5 mt-2.5 flex gap-1.5">
                  <div className="h-2.5 flex-1 rounded-full bg-danger/40" />
                  <div className="h-2.5 flex-1 rounded-full bg-warn/40" />
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
                    <span className="text-brand-ink">
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

            {score.features && <WhyThisScore role={role} features={score.features} finishedJobs={score.finishedJobs} />}
          </>
          )
        }
      </Async>
    </Page>
  )
}

// Shown until there are enough settled jobs to judge: progress, not a bad grade.
function NewMember({ finished, needed, tips }: { finished: number; needed: number; tips: string[] }) {
  const total = finished + needed
  const percent = total ? Math.round((finished / total) * 100) : 0

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card>
        <Label>Your trust level</Label>
        <Money>
          <span className="text-neutral-600">New</span>
        </Money>
        <Small>
          Your trust level appears once {total} of your jobs are finished. Until then you are not marked as low or
          high, just new.
        </Small>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-sm font-semibold">
            <span>
              {finished} of {total} jobs finished
            </span>
            <span className="text-muted">
              {needed} to go
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </Card>
      <Card>
        <Label>How to build it</Label>
        {tips.map((tip) => (
          <div key={tip} className="mt-3 flex items-start gap-2.5 text-[15px]">
            <span className="text-brand-ink">
              <Icon name="check" />
            </span>
            {tip}
          </div>
        ))}
      </Card>
    </div>
  )
}
