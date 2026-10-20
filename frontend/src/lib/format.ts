import type { Currency } from '../api/types'

export const formatMoney = (amount: number, currency: Currency | string = 'KES') =>
  `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`

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

export const firstName = (name: string) => name.split(' ')[0]

// "KES 418,000 · USD 30": one figure per currency, KES 0 when empty.
export const amountsLabel = (amounts: Record<string, number>) => {
  const parts = Object.entries(amounts).map(([currency, amount]) => formatMoney(amount, currency))
  return parts.length ? parts.join(' · ') : formatMoney(0)
}
