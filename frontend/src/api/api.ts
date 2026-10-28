import { get, patch, post } from './http'
import type {
  AdminDispute,
  AdminKycDetail,
  AdminKycRow,
  AdminPayment,
  AdminRefundRequest,
  AdminUser,
  Application,
  Conversion,
  Currency,
  Escrow,
  Job,
  JobLocation,
  KycInput,
  MyKyc,
  MyApplication,
  MyJob,
  Payment,
  PlatformOverview,
  Role,
  Transaction,
  TrustScore,
  User,
  Wallet,
  Withdrawal,
} from './types'

export const authApi = {
  // `identifier` is an email or a Kenyan mobile number.
  login: (identifier: string, password: string) =>
    post<{ token: string; user: User }>('/api/auth/login', { identifier, password }),
  register: (input: {
    name: string
    email: string
    phone: string
    password: string
    role: 'client' | 'worker'
    acceptTerms: boolean
  }) => post<User>('/api/auth/register', input),
  acceptTerms: () =>
    post<{ termsAccepted: true; termsVersion: string }>('/api/auth/accept-terms', {}),
}

export const termsApi = {
  current: () => get<{ version: string; url: string }>('/api/terms'),
}

export const walletApi = {
  get: () => get<{ wallet: Wallet }>('/api/wallet').then((r) => r.wallet),
  convert: (from: Currency, to: Currency, amount: number) =>
    get<{ conversion: Conversion }>('/api/wallet/convert', { from, to, amount }).then(
      (r) => r.conversion,
    ),
}

export const jobsApi = {
  mine: () => get<{ jobs: MyJob[] }>('/api/jobs/mine').then((r) => r.jobs),
  browse: (cursor?: string, near?: { lat: number; lng: number }) =>
    get<{ jobs: Job[]; nextCursor: string | null }>('/api/jobs', {
      cursor,
      lat: near?.lat,
      lng: near?.lng,
    }),
  // One job with its photos.
  get: (jobId: string) => get<{ job: Job }>(`/api/jobs/${jobId}`).then((r) => r.job),
  post: (input: {
    title: string
    description: string
    budget: number
    currency: Currency
    location?: JobLocation
    photos?: string[]
  }) => post<{ job: Job }>('/api/jobs', input).then((r) => r.job),
  apply: (jobId: string, price: number, message?: string) =>
    post<{ application: MyApplication }>(`/api/jobs/${jobId}/apply`, {
      price,
      ...(message ? { message } : {}),
    }).then((r) => r.application),
  // Change a pending quote while the job is still open.
  updateQuote: (jobId: string, input: { price?: number; message?: string }) =>
    patch<{ application: MyApplication }>(`/api/jobs/${jobId}/application`, input).then(
      (r) => r.application,
    ),
  applications: (jobId: string) =>
    get<{ applications: Application[]; nextCursor: string | null }>(
      `/api/jobs/${jobId}/applications`,
      { limit: 50 },
    ).then((r) => r.applications),
  select: (jobId: string, workerId: string) => post(`/api/jobs/${jobId}/select`, { workerId }),
}

export const escrowApi = {
  get: (jobId: string) => get<{ escrow: Escrow }>(`/api/escrow/${jobId}`).then((r) => r.escrow),
  complete: (jobId: string) => post(`/api/escrow/${jobId}/complete`),
  confirm: (jobId: string) => post(`/api/escrow/${jobId}/confirm`),
  // Pay a job's escrow from the wallet balance. The server works out the amount from the job.
  fund: (input: { jobId: string; workerId: string }) => post('/api/escrow/fund', input),
  refundRequest: (jobId: string, reason: string) =>
    post(`/api/escrow/${jobId}/refund-request`, { reason }),
  // Admin approves a pending refund request; the escrowed money goes back to the client.
  processRefund: (jobId: string) => post(`/api/escrow/${jobId}/process-refund`),
  dispute: (jobId: string, reason: string, photos?: string[]) =>
    post(`/api/escrow/${jobId}/dispute`, { reason, ...(photos?.length ? { photos } : {}) }),
  resolveDispute: (
    jobId: string,
    input: { decision: 'release' | 'refund' | 'split'; resolution: string; clientAmount?: number },
  ) => post(`/api/escrow/${jobId}/resolve-dispute`, input),
}

export const paymentsApi = {
  stkPush: (input: { jobId: string; workerId: string; phone?: string }) =>
    post<{ payment: Payment; message: string; simulated: boolean }>('/api/payments/stk-push', input),
  // Add money to the wallet with an M-Pesa prompt, with no job involved.
  topUp: (input: { amount: number; phone?: string }) =>
    post<{ payment: Payment; message: string; simulated: boolean }>('/api/payments/top-up', input),
  get: (checkoutRequestId: string) =>
    get<{ payment: Payment }>(`/api/payments/${checkoutRequestId}`).then((r) => r.payment),
  // Server test mode only: settle one of your test payments.
  simulate: (checkoutRequestId: string, outcome: 'success' | 'failure') =>
    post<{ payment: Payment }>(`/api/payments/${checkoutRequestId}/simulate`, { outcome }).then(
      (r) => r.payment,
    ),
  withdraw: (amount: number) =>
    post<{ withdrawal: Withdrawal }>('/api/payments/withdraw', { amount }).then(
      (r) => r.withdrawal,
    ),
}

export const transactionsApi = {
  list: (cursor?: string) =>
    get<{ transactions: Transaction[]; nextCursor: string | null }>('/api/transactions', {
      limit: 20,
      cursor,
    }),
}

export const kycApi = {
  // null until the worker has submitted something.
  me: () => get<{ kyc: MyKyc | null }>('/api/kyc/me').then((r) => r.kyc),
  submit: (input: KycInput) => post<{ kyc: MyKyc }>('/api/kyc', input).then((r) => r.kyc),
}

export const trustApi = {
  me: () => get<TrustScore>('/api/trust-score/me'),
}

export const adminApi = {
  overview: () => get<PlatformOverview>('/api/admin/overview'),
  disputes: (status?: 'open' | 'resolved') =>
    get<{ disputes: AdminDispute[]; nextCursor: string | null }>('/api/admin/disputes', {
      status,
      limit: 50,
    }).then((r) => r.disputes),
  // One dispute with its evidence photos.
  dispute: (jobId: string) =>
    get<{ dispute: AdminDispute }>(`/api/admin/disputes/${jobId}`).then((r) => r.dispute),
  refundRequests: (status?: 'pending' | 'approved') =>
    get<{ refundRequests: AdminRefundRequest[]; nextCursor: string | null }>(
      '/api/admin/refund-requests',
      { status, limit: 50 },
    ).then((r) => r.refundRequests),
  // Any client's or worker's trust level, for the user list.
  trustScore: (role: 'client' | 'worker', userId: string) =>
    get<TrustScore>(`/api/trust-score/${userId}`, { role }),
  // Workers who are party to a dispute: the only ones whose KYC an admin can open.
  kycList: () => get<{ workers: AdminKycRow[] }>('/api/admin/kyc').then((r) => r.workers),
  // Full record and photos; every call is written to the access log.
  kyc: (workerId: string) =>
    get<{ kyc: AdminKycDetail }>(`/api/admin/kyc/${workerId}`).then((r) => r.kyc),
  payments: (status?: string) =>
    get<{ payments: AdminPayment[]; nextCursor: string | null }>('/api/admin/payments', {
      status,
      limit: 50,
    }).then((r) => r.payments),
  users: (role?: Role) =>
    get<{ users: AdminUser[]; nextCursor?: string }>('/api/admin/users', { role, limit: 100 }).then(
      (r) => r.users,
    ),
  setUserStatus: (role: Role, id: string, status: 'active' | 'suspended', reason: string) =>
    patch<{ user: AdminUser }>(`/api/admin/users/${role}/${id}/status`, { status, reason }).then((r) => r.user),
}
