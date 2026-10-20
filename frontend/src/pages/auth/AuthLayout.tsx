import type { ReactNode } from 'react'

import { BrandMark, BrandName } from '../../components/Brand'
import Icon from '../../components/Icon'
import type { IconName } from '../../components/Icon'

const POINTS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'lock', title: 'Money held safely', text: 'Your payment waits in escrow until the work is done.' },
  { icon: 'check', title: 'Pay when it’s right', text: 'Release the money only when you are happy.' },
  { icon: 'shield', title: 'Trust you can see', text: 'Every client and worker has a trust level.' },
]

// Brand panel on the left (wide screens only) and the form on the right.
export default function AuthLayout({ title, sub, width = 'max-w-[460px]', children }: { title: string; sub: string; width?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#1a9248] via-brand to-brand-dark p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[28%] bg-white/95 text-brand shadow-lg">
            <Icon name="shield" size={24} />
          </span>
          <span className="text-xl font-extrabold tracking-tight">Escrow Wallet</span>
        </div>

        <div className="relative">
          <h2 className="m-0 text-4xl font-extrabold leading-tight tracking-tight">
            Hire and get paid,
            <br />
            without the worry.
          </h2>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-white/80">
            A safe way for clients and workers to do business, with M-Pesa built in.
          </p>
          <ul className="mt-9 flex list-none flex-col gap-5 p-0">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                  <Icon name={p.icon} size={22} />
                </span>
                <div>
                  <div className="font-bold">{p.title}</div>
                  <div className="text-sm leading-relaxed text-white/75">{p.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-sm text-white/60">Escrow-based wallet for East Africa</div>
      </aside>

      <main className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className={`flex w-full ${width} animate-rise flex-col gap-5`}>
          <div className="flex items-center gap-3 lg:hidden">
            <BrandMark size={40} />
            <BrandName />
          </div>
          <div>
            <h1 className="m-0 text-3xl font-extrabold tracking-tight">{title}</h1>
            <div className="mt-1.5 text-[15px] text-neutral-600">{sub}</div>
          </div>
          <div className="flex flex-col gap-5 rounded-3xl border border-line/70 bg-white p-6 shadow-card sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  )
}
