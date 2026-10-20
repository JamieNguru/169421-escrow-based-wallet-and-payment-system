import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import type { Role } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import Icon from './Icon'
import type { IconName } from './Icon'

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
    { to: '/worker/wallet', icon: 'wallet', label: 'Wallet' },
    { to: '/worker/history', icon: 'history', label: 'History' },
    { to: '/worker/trust', icon: 'shield', label: 'My Trust' },
  ],
  admin: [
    { to: '/admin', icon: 'home', label: 'Overview', end: true },
    { to: '/admin/disputes', icon: 'flag', label: 'Disputes' },
    { to: '/admin/users', icon: 'users', label: 'Users' },
    { to: '/admin/payments', icon: 'wallet', label: 'Payments' },
  ],
}

const ROLE_TITLE: Record<Role, string> = { client: 'Client', worker: 'Worker', admin: 'Admin' }

// Sidebar for one role; each page renders inside <Page> below.
export default function AppShell({ role }: { role: Role }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <nav className="sticky top-0 hidden h-screen w-[230px] shrink-0 flex-col gap-1 border-r border-line bg-white px-3.5 py-5 md:flex">
        <div className="mb-4 ml-2 text-xl font-bold">{ROLE_TITLE[role]}</div>
        {NAV[role].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-[10px] px-4 py-3 text-base ${
                isActive ? 'bg-brand-tint font-bold text-brand-dark' : 'text-neutral-700 hover:bg-canvas'
              }`
            }
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
        <MobileNav role={role} />
      </div>
    </div>
  )
}

// Phone-width fallback: the sidebar becomes a bottom bar.
function MobileNav({ role }: { role: Role }) {
  return (
    <nav className="sticky bottom-0 mt-auto flex justify-around border-t border-line bg-white py-2 md:hidden">
      {NAV[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 text-xs ${isActive ? 'font-bold text-brand' : 'text-muted'}`
          }
        >
          <Icon name={item.icon} size={24} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

// White header strip with the page title and the account menu, then the content area.
export function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-5 py-4 md:px-[30px]">
        <div>{header}</div>
        <AccountMenu />
      </header>
      <main className="flex flex-1 flex-col gap-4 px-5 py-5 md:px-[30px]">{children}</main>
    </>
  )
}

function AccountMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-neutral-400 bg-neutral-300 text-sm font-bold text-neutral-700"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border-[1.5px] border-line bg-white p-3 shadow-lg">
          <div className="text-sm font-bold">{user.name}</div>
          <div className="mb-3 truncate text-[13px] text-muted">{user.email}</div>
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg border-[1.5px] border-ink py-2 text-sm font-bold hover:bg-canvas"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
