import { get, patch, post } from './http'
import type {
  AdminDispute,
  AdminPayment,
  AdminUser,
  Application,
  Conversion,
  Currency,
  Escrow,
  Job,
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
  login: (email: string, password: string) =>
    post<{ token: string; user: User }>('/api/auth/login', { email, password }),
  register: (input: {
    name: string
    email: string
    phone: string
    password: string
    role: 'client' | 'worker'
  }) => post<User>('/api/auth/register', input),
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
  browse: (cursor?: string) =>
    get<{ jobs: Job[]; nextCursor: string | null }>('/api/jobs', { cursor }),
  post: (input: { title: string; description: string; budget: number; currency: Currency }) =>
    post<{ job: Job }>('/api/jobs', input).then((r) => r.job),
  apply: (jobId: string, message?: string) =>
    post(`/api/jobs/${jobId}/apply`, message ? { message } : {}),
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
  refundRequest: (jobId: string, reason: string) =>
    post(`/api/escrow/${jobId}/refund-request`, { reason }),
  dispute: (jobId: string, reason: string) => post(`/api/escrow/${jobId}/dispute`, { reason }),
  resolveDispute: (jobId: string, decision: 'release' | 'refund', resolution: string) =>
    post(`/api/escrow/${jobId}/resolve-dispute`, { decision, resolution }),
}

export const paymentsApi = {
  stkPush: (input: { jobId: string; workerId: string; amount: number; phone?: string }) =>
    post<{ payment: Payment; message: string }>('/api/payments/stk-push', input),
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
  payments: (status?: string) =>
    get<{ payments: AdminPayment[]; nextCursor: string | null }>('/api/admin/payments', {
      status,
      limit: 50,
    }).then((r) => r.payments),
  users: (role?: Role) =>
    get<{ users: AdminUser[]; nextCursor?: string }>('/api/admin/users', { role, limit: 100 }).then(
      (r) => r.users,
    ),
  setUserStatus: (role: Role, id: string, status: 'active' | 'suspended', reason?: string) =>
    patch<{ user: AdminUser }>(`/api/admin/users/${role}/${id}/status`, {
      status,
      ...(reason ? { reason } : {}),
    }).then((r) => r.user),
}
