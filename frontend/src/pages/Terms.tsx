import { Link } from 'react-router-dom'

import { termsApi } from '../api/api'
import { useAuth, homePathFor } from '../auth/AuthContext'
import { BrandMark, BrandName } from '../components/Brand'
import ThemeToggle from '../components/ThemeToggle'
import { Card } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: '1. What the platform does',
    body: [
      'Escrow Wallet holds a client’s payment while a worker does the job, and releases it when the client confirms the work is done.',
      'Funds held in escrow stay in escrow until they are released to the worker or refunded to the client under these terms.',
    ],
  },
  {
    title: '2. Your account',
    body: [
      'You must give accurate details, keep your password private and are responsible for what happens on your account.',
      'Workers must complete identity verification before applying for jobs.',
    ],
  },
  {
    title: '3. Payments and fees',
    body: [
      'Payments, top-ups and withdrawals go through M-Pesa. Amounts shown on the platform are the amounts that move.',
    ],
  },
  {
    title: '4. Disputes',
    body: [
      'If a client and a worker disagree about a job whose payment is held in escrow, either of them can raise a dispute.',
      'The platform decides disputes over escrowed funds, and its decision is final within the platform.',
      'This does not take away your right to take the matter to court or to arbitration.',
    ],
  },
  {
    title: '5. Changes to these terms',
    body: [
      'When we change these terms we publish a new version and ask you to accept it again. Until you do, you can sign in and look around, but you cannot post jobs, pay into escrow, withdraw or raise disputes.',
    ],
  },
]

// Public, so it can be read before signing up and linked from the register form.
export default function Terms() {
  const { user } = useAuth()
  const terms = useAsync(termsApi.current)
  const back = user ? homePathFor(user.role) : '/register'

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-4 border-b border-line/60 bg-surface/75 px-5 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-3">
          <BrandMark size={36} />
          <BrandName />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8">
        <div>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight">Terms of service</h1>
          <p className="mt-1 text-sm text-muted">
            {terms.data ? `Version ${terms.data.version}` : 'Loading version…'}
          </p>
        </div>
        <Card className="gap-6">
          {SECTIONS.map((section) => (
            <section key={section.title} className="flex flex-col gap-2">
              <h2 className="m-0 text-lg font-bold">{section.title}</h2>
              {section.body.map((text) => (
                <p key={text} className="m-0 text-[15px] leading-relaxed text-neutral-700">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </Card>
        <Link to={back} className="text-sm font-bold text-brand-ink">
          ← Back
        </Link>
      </main>
    </div>
  )
}
