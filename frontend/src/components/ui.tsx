import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

import type { TrustLevel } from '../api/types'
import Icon from './Icon'
import type { IconName } from './Icon'

export const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ')

export function Card({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <div
      className={cx(
        'flex flex-col rounded-3xl border border-line/70 bg-white p-5 shadow-card',
        interactive && 'transition duration-200 hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    >
      {children}
    </div>
  )
}

// A larger, softly tinted card for the number a page is about (the balance).
export function HeroCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'relative flex flex-col overflow-hidden rounded-3xl border border-[#cfe9d8] bg-gradient-to-br from-brand-tint via-white to-white p-6 shadow-card',
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand/10" />
      <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-brand/5" />
      <div className="relative flex flex-1 flex-col">{children}</div>
    </div>
  )
}

// Title and trust badge shown in the page header of each home screen.
export function Greeting({ name, badge }: { name: string; badge?: ReactNode }) {
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div>
      <h1 className="m-0 text-2xl font-extrabold tracking-tight">
        {hello}, {name}
      </h1>
      <div className="mt-1.5 min-h-[28px]">{badge}</div>
    </div>
  )
}

export const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</div>
)

export const Money = ({ children, size = 'text-[32px]' }: { children: ReactNode; size?: string }) => (
  <div className={cx('my-1 font-extrabold leading-tight tracking-tight', size)}>{children}</div>
)

export const Small = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('text-sm leading-relaxed text-neutral-600', className)}>{children}</div>
)

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="mx-0.5 mb-0 mt-3 text-lg font-bold tracking-tight text-ink">{children}</h2>
)

// A round icon badge used on cards and empty states.
export function IconBubble({ name, tone = 'green' }: { name: IconName; tone?: 'green' | 'amber' | 'red' | 'grey' }) {
  const tones = {
    green: 'bg-brand-tint text-brand',
    amber: 'bg-warn-tint text-warn',
    red: 'bg-danger-tint text-danger',
    grey: 'bg-neutral-100 text-neutral-500',
  }
  return (
    <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', tones[tone])}>
      <Icon name={name} size={22} />
    </span>
  )
}

type Tone = 'primary' | 'outline' | 'dark' | 'danger'
const TONES: Record<Tone, string> = {
  primary:
    'border-transparent bg-gradient-to-b from-[#1a9248] to-brand text-white shadow-button hover:from-brand hover:to-brand-dark hover:-translate-y-px',
  outline: 'border-line bg-white text-ink shadow-sm hover:border-neutral-300 hover:bg-neutral-50',
  dark: 'border-transparent bg-ink text-white shadow-md hover:bg-neutral-800 hover:-translate-y-px',
  danger: 'border-[#f3b0b0] bg-white text-danger hover:bg-danger-tint',
}

interface ButtonStyle {
  tone?: Tone
  small?: boolean
  icon?: IconName
  className?: string
}

const buttonClass = ({ tone = 'outline', small, className }: ButtonStyle) =>
  cx(
    // Full width unless the caller sets its own width (e.g. w-[120px]).
    'flex items-center justify-center gap-2 rounded-2xl border-[1.5px] font-bold transition duration-150 active:translate-y-0 active:scale-[0.99] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
    !/(^|\s)w-\[/.test(className ?? '') && 'w-full',
    small ? 'h-11 text-[15px]' : 'h-[52px] text-base',
    TONES[tone],
    className,
  )

export function Button({
  tone,
  small,
  icon,
  className,
  children,
  ...rest
}: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={buttonClass({ tone, small, className })}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </button>
  )
}

export function LinkButton({ tone, small, icon, className, children, ...rest }: ButtonStyle & LinkProps) {
  return (
    <Link {...rest} className={buttonClass({ tone, small, className })}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </Link>
  )
}

type ChipTone = 'green' | 'solid' | 'amber' | 'red' | 'grey'
const CHIP: Record<ChipTone, string> = {
  green: 'border-transparent bg-brand-tint text-brand-dark',
  solid: 'border-transparent bg-brand text-white shadow-sm',
  amber: 'border-transparent bg-warn-tint text-warn',
  red: 'border-transparent bg-danger-tint text-danger',
  grey: 'border-transparent bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
}

export function Chip({ tone = 'green', icon, children, onClick }: { tone?: ChipTone; icon?: IconName; children: ReactNode; onClick?: () => void }) {
  const className = cx(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors',
    CHIP[tone],
    onClick && 'cursor-pointer',
  )
  const content = (
    <>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  )
}

const TRUST_TONE: Record<TrustLevel, ChipTone> = { High: 'green', Medium: 'amber', Low: 'red' }

export const TrustBadge = ({ level }: { level: TrustLevel | string }) => (
  <Chip tone={TRUST_TONE[level as TrustLevel] ?? 'grey'} icon="star">
    Trust: {level}
  </Chip>
)

const fieldBox =
  'w-full rounded-2xl border-[1.5px] border-line bg-white px-4 text-[15px] text-ink shadow-sm transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:bg-neutral-50 disabled:text-neutral-500'

export function Field({ label, hint, ...rest }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-semibold text-neutral-700">{label}</div>
      <input {...rest} className={cx(fieldBox, 'h-12')} />
      {hint && <div className="mt-1.5 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

export function TextArea({ label, hint, ...rest }: { label: string; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-semibold text-neutral-700">{label}</div>
      <textarea {...rest} className={cx(fieldBox, 'h-28 resize-none py-3')} />
      {hint && <div className="mt-1.5 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

export function Select({ label, hint, children, ...rest }: { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-semibold text-neutral-700">{label}</div>
      <select {...rest} className={cx(fieldBox, 'h-12')}>
        {children}
      </select>
      {hint && <div className="mt-1.5 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

type BannerTone = 'green' | 'amber' | 'red'
const BANNER: Record<BannerTone, string> = {
  green: 'border-[#cfe9d8] bg-brand-tint/70 text-brand-dark',
  amber: 'border-[#f6d9ae] bg-warn-tint text-warn',
  red: 'border-[#f6c4c4] bg-danger-tint text-danger',
}

export function Banner({ tone = 'green', icon, title, children }: { tone?: BannerTone; icon?: IconName; title?: string; children?: ReactNode }) {
  return (
    <div className={cx('flex items-center gap-3.5 rounded-2xl border px-4 py-3.5', BANNER[tone])}>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
          <Icon name={icon} size={20} />
        </span>
      )}
      <div className="text-[15px] leading-snug">
        {title && <div className="text-base font-bold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export const ErrorNote = ({ message }: { message: string }) => (
  <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-[#f6c4c4] bg-danger-tint px-4 py-3 text-sm text-danger">
    <Icon name="alert" size={18} />
    <span>{message}</span>
  </div>
)

// Soft placeholder blocks while data loads, instead of a bare "Loading…".
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-shimmer rounded-2xl bg-neutral-200/70', className)} />
}

export const Loading = () => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-16 w-4/5" />
  </div>
)

export const Empty = ({ children, icon = 'check' }: { children: ReactNode; icon?: IconName }) => (
  <div className="flex flex-col items-center gap-3 rounded-3xl border-[1.5px] border-dashed border-neutral-300 bg-white/60 px-6 py-10 text-center text-sm text-muted">
    <IconBubble name={icon} tone="grey" />
    <div className="max-w-xs leading-relaxed">{children}</div>
  </div>
)

// Shows loading, error or the content, so pages only describe the happy path.
export function Async<T>({
  state,
  children,
}: {
  state: { data: T | undefined; error: string | null; loading: boolean }
  children: (data: T) => ReactNode
}) {
  if (state.error) return <ErrorNote message={state.error} />
  if (state.data === undefined) return state.loading ? <Loading /> : null
  return <>{children(state.data)}</>
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-line/70 bg-white px-3 py-2 shadow-card">
      <table className="w-full border-collapse text-[14.5px]">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="border-b border-line px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr]:transition-colors [&>tr:hover]:bg-brand-tint/40">{children}</tbody>
      </table>
    </div>
  )
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('border-b border-line/70 px-3 py-3.5 align-middle', className)}>{children}</td>
)

export const PageHead = ({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <h1 className="m-0 text-2xl font-extrabold tracking-tight">{title}</h1>
      {sub && <div className="mt-0.5 text-sm text-neutral-600">{sub}</div>}
    </div>
    {right}
  </div>
)
