import { Navigate, Route, Routes } from 'react-router-dom'

import { homePathFor, useAuth } from './auth/AuthContext'
import RequireRole from './auth/RequireRole'
import AppShell from './components/AppShell'
import AdminKycDetail from './pages/admin/KycDetail'
import AdminKycList from './pages/admin/KycList'
import Disputes from './pages/admin/Disputes'
import AdminOverview from './pages/admin/Overview'
import Payments from './pages/admin/Payments'
import ResolveDispute from './pages/admin/ResolveDispute'
import Users from './pages/admin/Users'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ChooseWorker from './pages/client/ChooseWorker'
import ClientDashboard from './pages/client/Dashboard'
import PayEscrow from './pages/client/PayEscrow'
import PostJob from './pages/client/PostJob'
import ReleasePayment from './pages/client/ReleasePayment'
import ReportProblem from './pages/client/ReportProblem'
import ClientWallet from './pages/client/Wallet'
import History from './pages/shared/History'
import Trust from './pages/shared/Trust'
import WorkerDashboard from './pages/worker/Dashboard'
import FindJobs from './pages/worker/FindJobs'
import Verification from './pages/worker/Verification'
import Withdraw from './pages/worker/Withdraw'

function Home() {
  const { user } = useAuth()
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<RequireRole role="client" />}>
        <Route path="/client" element={<AppShell role="client" />}>
          <Route index element={<ClientDashboard />} />
          <Route path="post-job" element={<PostJob />} />
          <Route path="jobs/:jobId/applicants" element={<ChooseWorker />} />
          <Route path="jobs/:jobId/pay" element={<PayEscrow />} />
          <Route path="jobs/:jobId/release" element={<ReleasePayment />} />
          <Route path="jobs/:jobId/report" element={<ReportProblem />} />
          <Route path="wallet" element={<ClientWallet />} />
          <Route path="history" element={<History />} />
          <Route path="trust" element={<Trust />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="worker" />}>
        <Route path="/worker" element={<AppShell role="worker" />}>
          <Route index element={<WorkerDashboard />} />
          <Route path="jobs" element={<FindJobs />} />
          <Route path="verification" element={<Verification />} />
          <Route path="wallet" element={<Withdraw />} />
          <Route path="history" element={<History />} />
          <Route path="trust" element={<Trust />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="admin" />}>
        <Route path="/admin" element={<AppShell role="admin" />}>
          <Route index element={<AdminOverview />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="disputes/:jobId" element={<ResolveDispute />} />
          <Route path="kyc" element={<AdminKycList />} />
          <Route path="kyc/:workerId" element={<AdminKycDetail />} />
          <Route path="users" element={<Users />} />
          <Route path="payments" element={<Payments />} />
        </Route>
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  )
}
