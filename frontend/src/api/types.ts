export type Role = 'client' | 'worker' | 'admin'
export type Currency = 'KES' | 'UGX' | 'TZS' | 'USD'
// 'New' means too little history to score yet.
export type TrustLevel = 'High' | 'Medium' | 'Low' | 'New'

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role: Role
  walletId?: string
  // False when the user hasn't accepted the current terms of service.
  termsAccepted?: boolean
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
  | 'split'

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
  clientAmount?: number
  workerAmount?: number
}

export interface JobLocation {
  label: string
  lat?: number
  lng?: number
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
  // The accepted quote, set when a worker is chosen. It replaces the budget and is locked.
  agreedPrice?: number
  agreedCurrency?: Currency
  // Browse only: the calling worker's own quote on this job.
  myApplication?: MyApplication
  location?: JobLocation
  // Lists carry the count; GET /api/jobs/:jobId adds the photos (data URLs).
  photoCount?: number
  photos?: string[]
  // Set when the worker sent a position and the job has coordinates.
  distanceKm?: number
  createdAt: string
}

export interface MyApplication {
  price?: number
  currency?: Currency
  message?: string
  status: 'pending' | 'selected' | 'rejected'
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
  // The worker's quote, in the job's currency (missing on applications from before quotes).
  price?: number
  currency?: Currency
  message?: string
  status: 'pending' | 'selected' | 'rejected'
  createdAt: string
  worker: { id: string; name: string; email: string; trustLevel?: TrustLevel; kyc: KycSummary | null }
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
  // Only for 'New': jobs settled so far and how many more are needed.
  finishedJobs?: number
  jobsNeeded?: number
}

export type PaymentStatus = 'pending' | 'completed' | 'failed'

export interface Payment {
  checkoutRequestId: string
  kind: 'escrow' | 'top_up'
  jobId?: string
  amount: number
  currency: Currency
  status: PaymentStatus
  failureReason?: string
  // True in the server's test mode: no real M-Pesa prompt was sent.
  simulated?: boolean
  // What settling did: funded the job's escrow, or only credited the wallet.
  settlement?: 'escrow_funded' | 'wallet_credited'
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
  photoCount?: number
  photos?: string[]
  decision?: 'release' | 'refund' | 'split'
  clientAmount?: number
  workerAmount?: number
  resolution?: string
  workerKyc?: KycSummary | null
}

export interface AdminRefundRequest {
  jobId: string
  jobTitle?: string
  amount: number
  currency: Currency
  reason: string
  status: 'pending' | 'approved'
  clientId: string
  clientName?: string
  workerId: string
  workerName?: string
  createdAt: string
  processedAt?: string
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

export type IdType = 'national_id' | 'passport'

export const ID_TYPE_LABEL: Record<IdType, string> = { national_id: 'National ID', passport: 'Passport' }

// A worker's own verification result: the ID number is already masked.
export interface MyKyc {
  status: 'verified' | 'rejected'
  fullName: string
  idType: IdType
  idNumber: string
  reasons: string[]
  submittedAt: string
  verifiedAt?: string
}

export interface KycInput {
  fullName: string
  idType: IdType
  idNumber: string
  dateOfBirth: string
  consent: boolean
  images: { front?: string; back?: string; selfie?: string }
}

// All a client (or the dispute screen) sees of a verified worker.
export interface KycSummary {
  verified: true
  name: string
  idType: IdType
  idNumberMasked: string
  verifiedAt: string
}

export interface AdminKycRow {
  workerId: string
  workerName?: string
  status: 'verified' | 'rejected' | 'not_submitted'
  idType?: IdType
  verifiedAt?: string
}

export interface AdminKycDetail {
  workerId: string
  workerName?: string
  status: 'verified' | 'rejected'
  fullName: string
  idType: IdType
  idNumber: string
  dateOfBirth: string
  consent: boolean
  reasons: string[]
  submittedAt: string
  verifiedAt?: string
  images: { front?: string; back?: string; selfie?: string }
}
