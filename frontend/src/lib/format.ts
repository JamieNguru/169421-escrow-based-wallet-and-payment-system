import type { Currency, Job } from '../api/types'

export const formatMoney = (amount: number, currency: Currency | string = 'KES') =>
  `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`

// What a job costs: the accepted quote once a worker is chosen, otherwise the client's budget (a guide).
// A delivery promise: whole hours up to two days, then days.
export const formatHours = (hours: number) =>
  hours < 48 ? `${Math.round(hours * 10) / 10} h` : `${Math.round((hours / 24) * 10) / 10} days`

export const jobPrice = (job: Pick<Job, 'budget' | 'currency' | 'agreedPrice' | 'agreedCurrency'>) =>
  job.agreedPrice !== undefined && job.agreedCurrency
    ? { amount: job.agreedPrice, currency: job.agreedCurrency }
    : { amount: job.budget, currency: job.currency }

export const formatJobPrice = (job: Parameters<typeof jobPrice>[0]) => {
  const { amount, currency } = jobPrice(job)
  return formatMoney(amount, currency)
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })

// "Today", "1 day", "2 days": how long a dispute has been waiting.
export const ageLabel = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  return days === 1 ? '1 day' : `${days} days`
}

// plural(1, 'job') is '1 job'; plural(2, 'job') is '2 jobs'.
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const firstName = (name: string) => name.split(' ')[0]

// "KES 418,000 · USD 30": one figure per currency, KES 0 when empty.
export const amountsLabel = (amounts: Record<string, number>) => {
  const parts = Object.entries(amounts).map(([currency, amount]) => formatMoney(amount, currency))
  return parts.length ? parts.join(' · ') : formatMoney(0)
}
