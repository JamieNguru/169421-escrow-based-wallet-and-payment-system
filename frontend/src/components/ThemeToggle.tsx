import { useSyncExternalStore } from 'react'

import { getTheme, subscribeTheme, toggleTheme } from '../lib/theme'
import Icon from './Icon'

// Sun/moon button that flips between light and dark.
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={`flex h-11 w-11 items-center justify-center rounded-full border border-line/70 bg-surface text-neutral-600 shadow-sm transition hover:scale-105 hover:text-ink ${className}`}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={20} />
    </button>
  )
}
