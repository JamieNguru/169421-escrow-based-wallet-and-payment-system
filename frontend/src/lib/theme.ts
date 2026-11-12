export type Theme = 'light' | 'dark'

const KEY = 'escrow.theme'
const listeners = new Set<() => void>()

// index.html applies the saved (or system) theme before the first paint, so
// the class on <html> is the source of truth here.
export const getTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode: the choice just lasts for this visit.
  }
  listeners.forEach((listener) => listener())
}

export const toggleTheme = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark')

export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
