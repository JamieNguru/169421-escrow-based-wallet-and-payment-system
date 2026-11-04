import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { BrandMark, BrandName } from '../components/Brand'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'
import ThemeToggle from '../components/ThemeToggle'

// The public front door: what Kaziforce is, how the money moves, and how trust is scored.
// Everything here is static or local state; nothing calls the API.

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#trust', label: 'Trust score' },
  { href: '#features', label: 'Features' },
  { href: '#faq', label: 'FAQ' },
]

export default function Landing() {
  return (
    <div className="relative overflow-x-clip">
      <Backdrop />
      <Header />
      <main>
        <Hero />
        <Highlights />
        <HowItWorks />
        <TrustScore />
        <Features />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

// ─── Small helpers ──────────────────────────────────────────────────────────────

// Fades and lifts its content in the first time it scrolls into view.
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
    >
      {children}
    </div>
  )
}

const SectionHead = ({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) => (
  <div className="mx-auto mb-10 max-w-2xl text-center">
    <div className="mb-3 inline-flex rounded-full bg-brand-tint px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-brand-ink">{eyebrow}</div>
    <h2 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h2>
    {sub && <p className="mt-3 text-base leading-relaxed text-muted">{sub}</p>}
  </div>
)

const Section = ({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) => (
  <section id={id} className={`mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-16 sm:px-8 sm:py-20 ${className}`}>
    {children}
  </section>
)

const money = (n: number) => `KES ${n.toLocaleString('en-KE')}`

// Soft colour blobs behind the page.
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] overflow-hidden">
      <div className="absolute -right-32 -top-40 h-[520px] w-[520px] animate-floaty rounded-full bg-brand/20 blur-3xl" />
      <div className="absolute -left-40 top-56 h-[420px] w-[420px] animate-floaty rounded-full bg-emerald-400/15 blur-3xl [animation-delay:-3s]" />
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────────

function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-30 transition-all duration-300 ${scrolled || open ? 'border-b border-line/60 bg-surface/80 shadow-sm backdrop-blur-md' : 'border-b border-transparent'}`}
    >
      <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3" aria-label="Kaziforce home">
          <BrandMark size={38} />
          <BrandName className="text-xl" />
        </a>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="rounded-full px-4 py-2 text-[15px] font-semibold text-neutral-600 transition-colors hover:bg-brand-tint hover:text-brand-ink">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <Link to="/login" className="hidden rounded-full px-4 py-2.5 text-[15px] font-bold text-ink transition-colors hover:bg-brand-tint sm:block">
            Log in
          </Link>
          <Link
            to="/register"
            className="hidden rounded-full bg-brand px-5 py-2.5 text-[15px] font-bold text-white shadow-button transition hover:-translate-y-0.5 hover:bg-brand-dark sm:block"
          >
            Get started
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line/70 bg-surface text-ink md:hidden"
          >
            <span className="flex w-5 flex-col gap-1.5">
              <span className={`h-0.5 rounded bg-current transition-transform ${open ? 'translate-y-2 rotate-45' : ''}`} />
              <span className={`h-0.5 rounded bg-current transition-opacity ${open ? 'opacity-0' : ''}`} />
              <span className={`h-0.5 rounded bg-current transition-transform ${open ? '-translate-y-2 -rotate-45' : ''}`} />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-rise border-t border-line/60 bg-surface/95 px-5 pb-5 pt-3 backdrop-blur-md md:hidden">
          <nav className="flex flex-col" aria-label="Sections">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-base font-semibold text-neutral-700 hover:bg-brand-tint">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex gap-3">
            <Link to="/login" className="flex-1 rounded-2xl border-[1.5px] border-line py-3 text-center font-bold">
              Log in
            </Link>
            <Link to="/register" className="flex-1 rounded-2xl bg-brand py-3 text-center font-bold text-white shadow-button">
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Hero with the live escrow demo ─────────────────────────────────────────────

function Hero() {
  return (
    <div id="top" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-12 pt-10 sm:px-8 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-20">
      <div className="animate-rise">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line/70 bg-surface/80 px-4 py-1.5 text-sm font-semibold text-neutral-600 shadow-sm backdrop-blur">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
          </span>
          M-Pesa payments, held in escrow
        </div>
        <h1 className="m-0 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Hire and get paid,{' '}
          <span className="bg-gradient-to-r from-brand via-emerald-500 to-teal-500 bg-clip-text text-transparent">without the worry.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Kaziforce holds the client’s money safely until the work is done, then releases it to the worker. Every client and worker has a trust level you can see before you commit.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/register"
            className="group flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-brand px-7 text-base font-bold text-white shadow-button transition hover:-translate-y-0.5 hover:bg-brand-dark"
          >
            Create a free account
            <span className="transition-transform group-hover:translate-x-1">
              <Icon name="arrow" size={20} />
            </span>
          </Link>
          <a
            href="#how"
            className="flex h-[54px] items-center justify-center rounded-2xl border-[1.5px] border-line bg-surface/70 px-7 text-base font-bold backdrop-blur transition hover:-translate-y-0.5 hover:border-brand/40 hover:text-brand-ink"
          >
            See how it works
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-neutral-600">
          {['No money moves until you approve', 'Disputes and refunds built in', 'KES, UGX, TZS and USD'].map((t) => (
            <span key={t} className="flex items-center gap-2">
              <span className="text-brand-ink">
                <Icon name="check" size={18} />
              </span>
              {t}
            </span>
          ))}
        </div>
      </div>

      <EscrowDemo />
    </div>
  )
}

const DEMO_STEPS = [
  { title: 'Job posted', note: 'Amina posts a job and agrees a price with Brian.', client: 3000, escrow: 0, worker: 0, icon: 'briefcase' as IconName },
  { title: 'Paid into escrow', note: 'Amina pays with M-Pesa. The money is held safely.', client: 0, escrow: 3000, worker: 0, icon: 'lock' as IconName },
  { title: 'Work delivered', note: 'Brian finishes the job and marks it done.', client: 0, escrow: 3000, worker: 0, icon: 'check' as IconName },
  { title: 'Payment released', note: 'Amina approves. Brian can withdraw to M-Pesa.', client: 0, escrow: 0, worker: 3000, icon: 'wallet' as IconName },
]

// A small interactive card that walks one KES 3,000 job through escrow. It advances
// by itself until the visitor takes over by clicking a step.
function EscrowDemo() {
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto) return
    const timer = setInterval(() => setStep((s) => (s + 1) % DEMO_STEPS.length), 3200)
    return () => clearInterval(timer)
  }, [auto])

  const current = DEMO_STEPS[step]
  const columns = [
    { label: 'Amina’s wallet', value: current.client, tone: 'bg-neutral-300' },
    { label: 'Held in escrow', value: current.escrow, tone: 'bg-brand' },
    { label: 'Brian’s wallet', value: current.worker, tone: 'bg-emerald-400' },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[460px] animate-rise [animation-delay:120ms]">
      <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand/25 via-transparent to-emerald-400/20 blur-2xl" />
      <div className="rounded-[2rem] border border-line/70 bg-surface p-5 shadow-lift sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Live example</div>
            <div className="text-lg font-extrabold">Fix a leaking kitchen tap</div>
          </div>
          <div className="rounded-2xl bg-brand-tint px-3 py-1.5 text-sm font-extrabold text-brand-ink">{money(3000)}</div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3" aria-live="polite">
          {columns.map((c) => (
            <div key={c.label} className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-50 p-3">
              <div className="flex h-24 w-full items-end overflow-hidden rounded-xl bg-neutral-100">
                <div className={`w-full rounded-xl ${c.tone} transition-all duration-700 ease-out`} style={{ height: `${(c.value / 3000) * 100}%` }} />
              </div>
              <div className="text-center text-[11px] font-bold leading-tight text-muted">{c.label}</div>
              <div className={`text-[13px] font-extrabold tabular-nums transition-colors ${c.value > 0 ? 'text-ink' : 'text-neutral-400'}`}>{money(c.value)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-line/70 bg-neutral-50 p-4">
          <span key={step} className="flex h-11 w-11 shrink-0 animate-rise items-center justify-center rounded-2xl bg-brand text-white shadow-button">
            <Icon name={current.icon} size={22} />
          </span>
          <div key={`t${step}`} className="animate-rise">
            <div className="font-extrabold">{current.title}</div>
            <div className="text-sm leading-relaxed text-muted">{current.note}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2" role="tablist" aria-label="Escrow steps">
          {DEMO_STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}: ${s.title}`}
              onClick={() => {
                setStep(i)
                setAuto(false)
              }}
              className="group flex-1 py-2"
            >
              <span className={`block h-1.5 rounded-full transition-all ${i <= step ? 'bg-brand' : 'bg-neutral-200 group-hover:bg-neutral-300'}`} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAuto((v) => !v)}
            aria-label={auto ? 'Pause the demo' : 'Play the demo'}
            className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/70 text-xs font-extrabold text-neutral-600 transition hover:border-brand/40 hover:text-brand-ink"
          >
            {auto ? '❚❚' : '▶'}
          </button>
        </div>
      </div>

      <div className="absolute -right-3 -top-4 hidden animate-floaty rounded-2xl border border-line/70 bg-surface px-3.5 py-2 text-sm font-bold shadow-lift sm:flex sm:items-center sm:gap-2">
        <span className="text-brand-ink">
          <Icon name="shield" size={18} />
        </span>
        High trust
      </div>
    </div>
  )
}

// ─── Highlights strip ───────────────────────────────────────────────────────────

const HIGHLIGHTS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'phone', title: 'M-Pesa built in', text: 'Fund and withdraw with the money you already use.' },
  { icon: 'lock', title: 'Held until approved', text: 'Nothing is released before the client says so.' },
  { icon: 'shield', title: 'Trust you can see', text: 'A Low, Medium or High level for every user.' },
  { icon: 'flag', title: 'Fair when things go wrong', text: 'Disputes are reviewed and money is split or returned.' },
]

function Highlights() {
  return (
    <Section className="!py-6 sm:!py-8">
      <div className="grid gap-4 rounded-[2rem] border border-line/70 bg-surface/80 p-5 shadow-card backdrop-blur sm:grid-cols-2 lg:grid-cols-4">
        {HIGHLIGHTS.map((h, i) => (
          <Reveal key={h.title} delay={i * 90} className="flex items-start gap-3.5 p-2">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-tint text-brand-ink">
              <Icon name={h.icon} size={24} />
            </span>
            <div>
              <div className="font-extrabold">{h.title}</div>
              <div className="text-sm leading-relaxed text-muted">{h.text}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}

// ─── How it works, with a client / worker switch ────────────────────────────────

const FLOWS = {
  client: {
    label: 'I want to hire',
    steps: [
      { icon: 'plus' as IconName, title: 'Post your job', text: 'Say what you need done and what you can pay. Workers send you their price and how fast they can deliver.' },
      { icon: 'users' as IconName, title: 'Choose a worker', text: 'Compare quotes alongside each worker’s trust level and delivery time, then pick the one you are comfortable with.' },
      { icon: 'lock' as IconName, title: 'Pay into escrow', text: 'Pay with M-Pesa. Your money is held safely, so the worker can start knowing it is there.' },
      { icon: 'check' as IconName, title: 'Release when happy', text: 'Check the work, then release the payment. If something is wrong, raise a dispute instead.' },
    ],
  },
  worker: {
    label: 'I want to work',
    steps: [
      { icon: 'lock' as IconName, title: 'Verify yourself', text: 'Add your ID once so clients know you are real. It takes a few minutes.' },
      { icon: 'search' as IconName, title: 'Find and quote jobs', text: 'Browse open jobs near you and send a price with the time you need to deliver.' },
      { icon: 'briefcase' as IconName, title: 'Do the work', text: 'When the client pays, the money is already in escrow. Finish the job and mark it done.' },
      { icon: 'phone' as IconName, title: 'Withdraw to M-Pesa', text: 'Once the client releases the payment it lands in your wallet. Send it to your phone any time.' },
    ],
  },
}

function HowItWorks() {
  const [role, setRole] = useState<keyof typeof FLOWS>('client')
  const flow = FLOWS[role]

  return (
    <Section id="how">
      <SectionHead eyebrow="How it works" title="Four steps, and the money stays safe throughout" sub="Pick your side to see what the journey looks like." />

      <Reveal className="mb-10 flex justify-center">
        <div role="tablist" aria-label="Who are you?" className="relative flex rounded-full border border-line/70 bg-surface p-1.5 shadow-card">
          <span
            aria-hidden="true"
            className={`absolute inset-y-1.5 w-[calc(50%-0.375rem)] rounded-full bg-brand shadow-button transition-transform duration-300 ease-out ${role === 'worker' ? 'translate-x-full' : ''}`}
          />
          {(Object.keys(FLOWS) as Array<keyof typeof FLOWS>).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={role === key}
              onClick={() => setRole(key)}
              className={`relative z-10 w-40 rounded-full py-2.5 text-[15px] font-bold transition-colors sm:w-48 ${role === key ? 'text-white' : 'text-neutral-600 hover:text-ink'}`}
            >
              {FLOWS[key].label}
            </button>
          ))}
        </div>
      </Reveal>

      <div key={role} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {flow.steps.map((s, i) => (
          <div
            key={s.title}
            style={{ animationDelay: `${i * 80}ms` }}
            className="group relative animate-rise rounded-3xl border border-line/70 bg-surface p-6 shadow-card transition duration-300 hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-lift"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-tint text-brand-ink transition-colors group-hover:bg-brand group-hover:text-white">
                <Icon name={s.icon} size={24} />
              </span>
              <span className="text-4xl font-extrabold text-neutral-200 transition-colors group-hover:text-brand/30">{i + 1}</span>
            </div>
            <h3 className="m-0 text-lg font-extrabold">{s.title}</h3>
            <p className="mb-0 mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Trust score playground ─────────────────────────────────────────────────────

type Level = 'Low' | 'Medium' | 'High'

// A simple stand-in for the real model, so visitors can see how behaviour moves the level.
function illustrate(completed: number, disputes: number, late: number): { score: number; level: Level } {
  const score = Math.max(0, Math.min(100, completed - disputes * 1.6 - late * 0.45))
  return { score, level: score >= 80 ? 'High' : score >= 52 ? 'Medium' : 'Low' }
}

const LEVEL_STYLE: Record<Level, { text: string; bg: string; note: string }> = {
  High: { text: 'text-brand-ink', bg: 'bg-brand-tint', note: 'Clients and workers can rely on this user.' },
  Medium: { text: 'text-warn', bg: 'bg-warn-tint', note: 'A mixed record, so it is worth checking the details.' },
  Low: { text: 'text-danger', bg: 'bg-danger-tint', note: 'Frequent problems. Take extra care before working together.' },
}

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-bold">{label}</span>
        <span className="text-lg font-extrabold tabular-nums text-brand-ink">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-brand"
      />
      <div className="mt-1.5 text-[13px] text-muted">{hint}</div>
    </label>
  )
}

function Gauge({ score, level }: { score: number; level: Level }) {
  // The needle sweeps 180° across the arc as the score goes from 0 to 100.
  const angle = -90 + (score / 100) * 180
  return (
    <svg viewBox="0 0 240 140" className="mx-auto w-full max-w-[340px]" role="img" aria-label={`Trust level ${level}`}>
      <path d="M20 120 A100 100 0 0 1 91.5 24.2" fill="none" stroke="var(--color-danger)" strokeWidth="18" strokeLinecap="round" opacity="0.85" />
      <path d="M99 22.4 A100 100 0 0 1 163.2 33.4" fill="none" stroke="#f59e0b" strokeWidth="18" strokeLinecap="round" opacity="0.9" />
      <path d="M171 36.5 A100 100 0 0 1 220 120" fill="none" stroke="var(--color-brand)" strokeWidth="18" strokeLinecap="round" opacity="0.95" />
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '120px 120px', transition: 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)' }}>
        <path d="M120 120 L120 38" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="120" cy="38" r="5" fill="var(--color-ink)" />
      </g>
      <circle cx="120" cy="120" r="10" fill="var(--color-ink)" />
      <circle cx="120" cy="120" r="4" fill="var(--color-surface)" />
    </svg>
  )
}

function TrustScore() {
  const [completed, setCompleted] = useState(92)
  const [disputes, setDisputes] = useState(4)
  const [late, setLate] = useState(10)
  const { score, level } = illustrate(completed, disputes, late)
  const style = LEVEL_STYLE[level]

  const presets: Array<{ label: string; values: [number, number, number] }> = [
    { label: 'Reliable worker', values: [96, 2, 5] },
    { label: 'Mixed record', values: [86, 8, 20] },
    { label: 'Risky', values: [55, 35, 60] },
  ]

  return (
    <Section id="trust">
      <SectionHead
        eyebrow="Trust score"
        title="See who you are dealing with before you commit"
        sub="Every client and worker gets a Low, Medium or High trust level, worked out from what they have actually done on the platform."
      />
      <Reveal>
        <div className="grid gap-8 rounded-[2rem] border border-line/70 bg-surface p-6 shadow-card sm:p-9 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setCompleted(p.values[0])
                    setDisputes(p.values[1])
                    setLate(p.values[2])
                  }}
                  className="rounded-full border border-line/70 px-4 py-1.5 text-sm font-bold text-neutral-600 transition hover:border-brand/40 hover:bg-brand-tint hover:text-brand-ink"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Slider label="Jobs completed" value={completed} onChange={setCompleted} hint="Jobs that ended with the money released." />
            <Slider label="Jobs that ended in a dispute" value={disputes} onChange={setDisputes} hint="Disputes raised against this user." />
            <Slider label="Delivered late" value={late} onChange={setLate} hint="How far past the promised time the work ran." />
          </div>

          <div className="flex flex-col items-center justify-center rounded-3xl bg-neutral-50 p-6 text-center">
            <Gauge score={score} level={level} />
            <div className={`-mt-1 inline-flex rounded-full px-5 py-1.5 text-xl font-extrabold transition-colors ${style.bg} ${style.text}`}>{level} trust</div>
            <p className="mb-0 mt-3 max-w-xs text-[15px] leading-relaxed text-muted">{style.note}</p>
            <p className="mb-0 mt-5 max-w-sm text-xs leading-relaxed text-neutral-400">
              This is an illustration. The real score comes from a Random Forest model trained on completion, dispute and delivery history, and a new user shows as “New” until they have a few finished jobs.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}

// ─── Features ───────────────────────────────────────────────────────────────────

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'lock', title: 'Escrow wallet', text: 'Funds sit in escrow from the moment the client pays until they release or get refunded.' },
  { icon: 'phone', title: 'M-Pesa top-ups and payouts', text: 'Clients pay with an M-Pesa prompt, and workers withdraw to their phone.' },
  { icon: 'shield', title: 'Verified workers', text: 'Workers add their ID and, for larger earnings, a tax PIN, so clients know who they hire.' },
  { icon: 'star', title: 'Two trust models', text: 'Workers and clients are scored separately, because they are judged on different things.' },
  { icon: 'flag', title: 'Disputes and refunds', text: 'Either side can raise a problem. An admin reviews it and releases, splits or refunds the money.' },
  { icon: 'history', title: 'Clear history', text: 'Every payment, release and refund is recorded, with a yearly earnings statement.' },
]

function Features() {
  return (
    <Section id="features">
      <SectionHead eyebrow="Features" title="Everything a small job needs, and nothing it does not" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 90}>
            <div className="group h-full rounded-3xl border border-line/70 bg-surface p-6 shadow-card transition duration-300 hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-lift">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-tint to-brand/25 text-brand-ink transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                <Icon name={f.icon} size={24} />
              </span>
              <h3 className="m-0 text-lg font-extrabold">{f.title}</h3>
              <p className="mb-0 mt-2 text-[15px] leading-relaxed text-muted">{f.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}

// ─── FAQ ────────────────────────────────────────────────────────────────────────

const FAQS = [
  { q: 'When does the worker get paid?', a: 'When the client confirms the work is done. Until then the money stays in escrow, so it is not with the client or the worker.' },
  { q: 'What if the work is not right?', a: 'The client can raise a dispute instead of releasing the payment. An admin looks at both sides and decides whether to release, split or refund the money.' },
  { q: 'Do I need M-Pesa?', a: 'Yes. Clients pay in with an M-Pesa prompt and workers withdraw to their M-Pesa number. Amounts can be shown in KES, UGX, TZS or USD.' },
  { q: 'How is the trust level worked out?', a: 'From real history: how many jobs were completed, how many ended in disputes, and how close to the promised time work was delivered. Clients are scored on payment and refund behaviour.' },
  { q: 'Is it free to join?', a: 'You can create an account for free. Workers verify their identity once before they can send quotes.' },
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <Section id="faq" className="max-w-3xl">
      <SectionHead eyebrow="FAQ" title="Questions people ask first" />
      <div className="flex flex-col gap-3">
        {FAQS.map((item, i) => {
          const isOpen = open === i
          return (
            <Reveal key={item.q} delay={i * 60}>
              <div className={`rounded-2xl border bg-surface shadow-card transition-colors ${isOpen ? 'border-brand/40' : 'border-line/70'}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-bold"
                >
                  {item.q}
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-lg font-extrabold text-brand-ink transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}>+</span>
                </button>
                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <p className="m-0 px-5 pb-5 text-[15px] leading-relaxed text-muted">{item.a}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          )
        })}
      </div>
    </Section>
  )
}

// ─── Closing call to action and footer ──────────────────────────────────────────

function FinalCta() {
  return (
    <Section className="!pt-4">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2.2rem] bg-gradient-to-br from-[#1a9248] via-brand to-brand-dark px-6 py-14 text-center text-white shadow-lift sm:px-12 sm:py-16">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10" />
          <div className="absolute -bottom-28 -left-12 h-72 w-72 rounded-full bg-white/10" />
          <div className="relative">
            <h2 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Ready to hire or get hired the safe way?</h2>
            <p className="mx-auto mb-0 mt-3 max-w-xl text-base leading-relaxed text-white/80">Create an account in a minute. Your money is only ever released when you say so.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/register" className="flex h-[54px] items-center justify-center rounded-2xl bg-white px-8 text-base font-extrabold text-brand-dark shadow-lg transition hover:-translate-y-0.5">
                Get started
              </Link>
              <Link to="/login" className="flex h-[54px] items-center justify-center rounded-2xl border-[1.5px] border-white/50 px-8 text-base font-bold text-white transition hover:bg-white/10">
                I already have an account
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:px-8">
        <div className="flex items-center gap-3">
          <BrandMark size={30} />
          <span>
            <span className="font-extrabold text-ink">Kaziforce</span> · Escrow-based wallet for East Africa
          </span>
        </div>
        <div className="flex items-center gap-5 font-semibold">
          <Link to="/terms" className="hover:text-brand-ink">
            Terms of service
          </Link>
          <Link to="/login" className="hover:text-brand-ink">
            Log in
          </Link>
          <Link to="/register" className="hover:text-brand-ink">
            Register
          </Link>
        </div>
        <div>A Strathmore University capstone project</div>
      </div>
    </footer>
  )
}
