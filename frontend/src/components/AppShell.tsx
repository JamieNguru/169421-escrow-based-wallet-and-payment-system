import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import type { Role } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { BrandMark, BrandName } from './Brand'
import Icon from './Icon'
import { Button } from './ui'
import type { IconName } from './Icon'
import ThemeToggle from './ThemeToggle'

interface NavItem {
  to: string
  icon: IconName
  label: string
  end?: boolean
}

const NAV: Record<Role, NavItem[]> = {
  client: [
    { to: '/client', icon: 'home', label: 'Home', end: true },
    { to: '/client/post-job', icon: 'plus', label: 'Post a Job' },
    { to: '/client/wallet', icon: 'wallet', label: 'Wallet' },
    { to: '/client/history', icon: 'history', label: 'History' },
    { to: '/client/trust', icon: 'shield', label: 'My Trust' },
  ],
  worker: [
    { to: '/worker', icon: 'home', label: 'Home', end: true },
    { to: '/worker/jobs', icon: 'search', label: 'Find Jobs' },
    { to: '/worker/verification', icon: 'lock', label: 'Verification' },
    { to: '/worker/wallet', icon: 'wallet', label: 'Wallet' },
    { to: '/worker/history', icon: 'history', label: 'History' },
    { to: '/worker/trust', icon: 'shield', label: 'My Trust' },
  ],
  admin: [
    { to: '/admin', icon: 'home', label: 'Overview', end: true },
    { to: '/admin/disputes', icon: 'flag', label: 'Disputes' },
    { to: '/admin/refunds', icon: 'history', label: 'Refunds' },
    { to: '/admin/kyc', icon: 'lock', label: 'Worker KYC' },
    { to: '/admin/users', icon: 'users', label: 'Users' },
    { to: '/admin/payments', icon: 'wallet', label: 'Payments' },
  ],
}

const ROLE_LABEL: Record<Role, string> = { client: 'Client', worker: 'Worker', admin: 'Admin' }

// Sidebar for one role; each page renders inside <Page> below.
export default function AppShell({ role }: { role: Role }) {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col border-r border-line/70 bg-surface/80 px-4 py-6 backdrop-blur md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <BrandMark size={38} />
          <div className="leading-tight">
            <BrandName className="block text-[17px]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-ink">{ROLE_LABEL[role]}</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV[role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-brand-tint text-brand-ink shadow-[inset_3px_0_0_0_var(--color-brand)]'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-ink'
                }`
              }
            >
              <Icon name={item.icon} size={21} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="mt-auto flex items-center gap-3 rounded-2xl bg-neutral-50 p-3">
            <Avatar name={user.name} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{user.name}</div>
              <div className="truncate text-xs text-muted">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              title="Log out"
              className="rounded-xl p-2 text-neutral-500 transition-colors hover:bg-surface hover:text-danger"
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TermsPrompt />
        <Outlet />
        <MobileNav role={role} />
      </div>
    </div>
  )
}

// Asks users who haven't accepted the current terms to do so; until they do
// the server refuses jobs, escrow funding, payments and disputes.
function TermsPrompt() {
  const { user, acceptTerms } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user || user.role === 'admin' || user.termsAccepted !== false) return null

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      await acceptTerms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-warn/30 bg-warn-tint px-5 py-3.5 text-warn md:flex-row md:items-center md:justify-between md:px-8">
      <div className="text-[15px] leading-snug">
        <span className="font-bold">Please accept our terms of service.</span> Until you do, you can’t post jobs, pay
        into escrow, withdraw or raise a dispute.{' '}
        <Link to="/terms" target="_blank" className="font-bold underline">
          Read the terms
        </Link>
        {error && <span className="ml-2 font-semibold text-danger">{error}</span>}
      </div>
      <Button tone="primary" small className="w-[160px] shrink-0" onClick={accept} disabled={busy}>
        {busy ? 'Saving…' : 'I accept'}
      </Button>
    </div>
  )
}

function Avatar({ name, size = 'h-10 w-10' }: { name: string; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-tint to-brand/25 text-sm font-extrabold text-brand-ink ring-2 ring-white`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

// Phone-width fallback: the sidebar becomes a bottom bar.
function MobileNav({ role }: { role: Role }) {
  return (
    <nav className="sticky bottom-0 z-20 mt-auto flex justify-around border-t border-line/70 bg-surface/90 px-2 py-2 backdrop-blur md:hidden">
      {NAV[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-semibold ${isActive ? 'bg-brand-tint text-brand-ink' : 'text-muted'}`
          }
        >
          <Icon name={item.icon} size={22} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

// Frosted header strip with the page title and the account menu, then the content area.
export function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line/60 bg-surface/75 px-5 py-4 backdrop-blur-md md:px-8">
        <div>{header}</div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 animate-rise flex-col gap-5 px-5 py-6 md:px-8 md:py-7">
        {children}
      </main>
    </>
  )
}

function AccountMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!user) return null

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full transition-transform hover:scale-105"
      >
        <Avatar name={user.name} size="h-11 w-11" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-3 w-60 animate-rise rounded-2xl border border-line/70 bg-surface p-4 shadow-lift">
          <div className="text-sm font-bold">{user.name}</div>
          <div className="mb-3 truncate text-[13px] text-muted">{user.email}</div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-line py-2.5 text-sm font-bold transition-colors hover:border-danger/40 hover:bg-danger-tint hover:text-danger"
          >
            <Icon name="logout" size={17} />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
