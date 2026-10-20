export type Role = 'client' | 'worker' | 'admin'
export type Currency = 'KES' | 'UGX' | 'TZS' | 'USD'
export type TrustLevel = 'High' | 'Medium' | 'Low'

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role: Role
  walletId?: string
}

export interface Wallet {
  id: string
  balance: number
  escrowBalance: number
  currency: Currency
}

export interface Conversion {
  from: Currency
  to: Currency
  amount: number
  rate: number
  converted: number
  rateUpdatedAt: string
}

export type EscrowStatus =
  | 'pending'
  | 'in_escrow'
  | 'work_submitted'
  | 'disputed'
  | 'completed'
  | 'refunded'

export interface Escrow {
  jobId: string
  clientId: string
  workerId: string
  amount: number
  currency: Currency
  status: EscrowStatus
  createdAt: string
  fundedAt: string
  workSubmittedAt?: string
  completedAt?: string
  refundedAt?: string
  disputedAt?: string
}

export interface Job {
  id: string
  clientId: string
  workerId?: string
  title: string
  description: string
  budget: number
  currency: Currency
  status: 'open' | 'assigned'
  createdAt: string
}

export interface MyJob extends Job {
  escrowStatus?: EscrowStatus
  counterpartyName?: string
  applicantCount?: number
}

export interface Application {
  id: string
  jobId: string
  workerId: string
  message?: string
  status: 'pending' | 'selected' | 'rejected'
  createdAt: string
  worker: { id: string; name: string; email: string }
}

export interface Transaction {
  id: string
  jobId?: string
  type: string
  amount: number
  currency: Currency
  fromUserId: string
  toUserId: string
  createdAt: string
}

export interface TrustScore {
  userId: string
  role: 'client' | 'worker'
  trustLevel: TrustLevel
  probabilities: Record<string, number>
}

export interface Payment {
  checkoutRequestId: string
  jobId: string
  amount: number
  currency: Currency
}

export interface Withdrawal {
  workerId: string
  amount: number
  currency: Currency
  phone: string
  status: 'pending' | 'completed' | 'failed'
}

export interface AdminDispute {
  jobId: string
  jobTitle?: string
  amount: number
  currency: Currency
  status: 'open' | 'resolved'
  reason: string
  raisedByRole: 'client' | 'worker'
  clientId: string
  clientName?: string
  workerId: string
  workerName?: string
  createdAt: string
  decision?: 'release' | 'refund'
  resolution?: string
}

export interface AdminPayment {
  id: string
  kind: 'payment' | 'withdrawal'
  status: string
  amount: number
  currency: Currency
  phone?: string
  jobId?: string
  userId: string
  userName?: string
  failureReason?: string
  createdAt: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  phone?: string
  role: Role
  status: 'active' | 'suspended'
  statusReason?: string
  createdAt: string
}

type Counts = Record<string, number>
type Amounts = Record<string, number>

export interface PlatformOverview {
  jobs: { total: number; byStatus: Counts }
  escrows: {
    total: number
    byStatus: Counts
    amounts: { held: Amounts; released: Amounts; refunded: Amounts }
  }
  payments: { total: number; byStatus: Counts }
  withdrawals: { total: number; byStatus: Counts }
  disputes: { total: number; open: number; resolved: number }
  refundRequests: { total: number; pending: number; approved: number }
  trust: {
    scored: number
    unavailable: number
    byLevel: Record<'client' | 'worker', Counts>
    lowTrustUsers: Array<{ id: string; role: 'client' | 'worker'; name?: string }>
  }
  activity: { paymentsToday: number; failedPaymentsToday: number; activeUsers: number }
}
