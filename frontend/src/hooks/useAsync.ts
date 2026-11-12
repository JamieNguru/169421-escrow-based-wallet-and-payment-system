import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

// Runs `load` on mount, when `deps` change, and whenever `reload()` is called.
// A stale response (the component re-ran or unmounted meanwhile) is ignored.
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList = []): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let current = true
    setLoading(true)
    loadRef
      .current()
      .then((result) => {
        if (!current) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err.message : 'Something went wrong')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, error, loading, reload }
}
