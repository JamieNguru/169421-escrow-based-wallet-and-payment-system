import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

import type { TrustLevel } from '../api/types'
import Icon from './Icon'
import type { IconName } from './Icon'

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ')

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col rounded-2xl border-[1.5px] border-line bg-white p-4', className)}>
      {children}
    </div>
  )
}

export const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-[13px] uppercase tracking-wide text-muted">{children}</div>
)

export const Money = ({ children, size = 'text-[32px]' }: { children: ReactNode; size?: string }) => (
  <div className={cx('my-1 font-bold', size)}>{children}</div>
)

export const Small = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('text-sm text-neutral-600', className)}>{children}</div>
)

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="mx-0.5 mt-1 text-[15px] font-bold text-neutral-700">{children}</div>
)

type Tone = 'primary' | 'outline' | 'dark' | 'danger'
const TONES: Record<Tone, string> = {
  primary: 'border-brand bg-brand text-white hover:bg-brand-dark',
  outline: 'border-ink bg-white text-ink hover:bg-canvas',
  dark: 'border-ink bg-ink text-white hover:bg-neutral-800',
  danger: 'border-danger bg-white text-danger hover:bg-danger-tint',
}

interface ButtonStyle {
  tone?: Tone
  small?: boolean
  icon?: IconName
  className?: string
}

const buttonClass = ({ tone = 'outline', small, className }: ButtonStyle) =>
  cx(
    'flex w-full items-center justify-center gap-2 rounded-xl border-2 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    small ? 'h-[42px] text-[15px]' : 'h-[52px] text-[17px]',
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
  green: 'border-brand bg-brand-tint text-brand-dark',
  solid: 'border-brand bg-brand text-white',
  amber: 'border-[#f5c98a] bg-warn-tint text-warn',
  red: 'border-[#f3b0b0] bg-danger-tint text-danger',
  grey: 'border-[#d0d3d8] bg-[#f1f2f4] text-neutral-600',
}

export function Chip({ tone = 'green', icon, children, onClick }: { tone?: ChipTone; icon?: IconName; children: ReactNode; onClick?: () => void }) {
  const className = cx(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-2.5 py-1 text-[13px] font-bold',
    CHIP[tone],
    onClick && 'cursor-pointer',
  )
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
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
  'w-full rounded-[10px] border-[1.5px] border-[#cfd4db] bg-white px-3.5 text-[15px] text-ink placeholder:text-[#9ca3af] focus:border-brand focus:outline-none'

export function Field({ label, hint, ...rest }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-bold text-neutral-700">{label}</div>
      <input {...rest} className={cx(fieldBox, 'h-[46px]')} />
      {hint && <div className="mt-1 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

export function TextArea({ label, hint, ...rest }: { label: string; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-bold text-neutral-700">{label}</div>
      <textarea {...rest} className={cx(fieldBox, 'h-24 resize-none py-3')} />
      {hint && <div className="mt-1 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

export function Select({ label, hint, children, ...rest }: { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block flex-1">
      <div className="mb-1.5 text-sm font-bold text-neutral-700">{label}</div>
      <select {...rest} className={cx(fieldBox, 'h-[46px]')}>
        {children}
      </select>
      {hint && <div className="mt-1 text-[13px] text-muted">{hint}</div>}
    </label>
  )
}

type BannerTone = 'green' | 'amber' | 'red'
const BANNER: Record<BannerTone, string> = {
  green: 'border-[#b7dfc4] bg-brand-tint text-brand-dark',
  amber: 'border-[#f5c98a] bg-warn-tint text-warn',
  red: 'border-[#f3b0b0] bg-danger-tint text-danger',
}

export function Banner({ tone = 'green', icon, title, children }: { tone?: BannerTone; icon?: IconName; title?: string; children?: ReactNode }) {
  return (
    <div className={cx('flex items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3', BANNER[tone])}>
      {icon && <Icon name={icon} />}
      <div className="text-[15px]">
        {title && <div className="text-[17px] font-bold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export const ErrorNote = ({ message }: { message: string }) => (
  <div role="alert" className="rounded-xl border-[1.5px] border-[#f3b0b0] bg-danger-tint px-4 py-3 text-sm text-danger">
    {message}
  </div>
)

export const Loading = () => <div className="p-6 text-center text-sm text-muted">Loading…</div>

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-2xl border-[1.5px] border-dashed border-line bg-white p-8 text-center text-sm text-muted">
    {children}
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
    <div className="overflow-x-auto rounded-2xl border-[1.5px] border-line bg-white px-3 py-1.5">
      <table className="w-full border-collapse text-[14.5px]">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="border-b-[1.5px] border-line px-3 py-2.5 text-left text-[12.5px] font-normal uppercase tracking-wide text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">{children}</tbody>
      </table>
    </div>
  )
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('border-b border-line px-3 py-3 align-middle', className)}>{children}</td>
)

export const PageHead = ({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <h1 className="m-0 text-[22px] font-bold">{title}</h1>
      {sub && <div className="mt-0.5 text-sm text-neutral-600">{sub}</div>}
    </div>
    {right}
  </div>
)
