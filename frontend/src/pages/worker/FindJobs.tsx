import { useCallback, useEffect, useState } from 'react'

import { jobsApi } from '../../api/api'
import type { Currency, Job } from '../../api/types'
import { Page } from '../../components/AppShell'
import Icon from '../../components/Icon'
import { Button, Chip, Empty, ErrorNote, Loading, PageHead } from '../../components/ui'
import { getPosition } from '../../lib/geo'
import type { Position } from '../../lib/geo'
import JobTile from './JobTile'

const CURRENCIES: Array<Currency | 'All'> = ['All', 'KES', 'UGX', 'TZS', 'USD']

// Browse open jobs (wireframe 11). Search is client-side over the loaded pages;
// the API filters by currency only. Sharing a position adds each job's distance.
export default function FindJobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [currency, setCurrency] = useState<Currency | 'All'>('All')
  const [near, setNear] = useState<Position | null>(null)
  const [locating, setLocating] = useState(false)
  const [nearest, setNearest] = useState(false)

  const load = useCallback(
    async (next?: string) => {
      setLoading(true)
      setError(null)
      try {
        const page = await jobsApi.browse(next, near ?? undefined)
        setJobs((current) => (next ? [...current, ...page.jobs] : page.jobs))
        setCursor(page.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load jobs')
      } finally {
        setLoading(false)
      }
    },
    [near],
  )

  useEffect(() => {
    void load()
  }, [load])

  const findMe = async () => {
    setLocating(true)
    setError(null)
    try {
      setNear(await getPosition())
      setNearest(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get your location')
    } finally {
      setLocating(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const visible = jobs
    .filter(
      (job) =>
        (currency === 'All' || job.currency === currency) &&
        (!needle || `${job.title} ${job.description} ${job.location?.label ?? ''}`.toLowerCase().includes(needle)),
    )
    // Nearest first when sharing a position; jobs without coordinates go last.
    .sort((a, b) => (nearest ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) : 0))

  return (
    <Page header={<PageHead title="Find jobs" sub="Jobs posted by clients" />}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a job, e.g. plumbing, or a place"
          aria-label="Search jobs"
          className="h-[46px] w-full flex-1 rounded-[10px] border-[1.5px] border-[#cfd4db] bg-white px-3.5 text-[15px] placeholder:text-[#9ca3af] focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          disabled={locating}
          onClick={() => void findMe()}
          className="flex h-[46px] shrink-0 items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-[#cfd4db] bg-white px-4 text-[15px] hover:bg-canvas disabled:opacity-50"
        >
          <Icon name="pin" size={18} />
          {locating ? 'Finding you…' : near ? 'Near you' : 'Near me'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {CURRENCIES.map((c) => (
          <Chip key={c} tone={currency === c ? 'solid' : 'grey'} onClick={() => setCurrency(c)}>
            {c}
          </Chip>
        ))}
        {near && (
          <Chip tone={nearest ? 'solid' : 'grey'} onClick={() => setNearest((v) => !v)}>
            Nearest first
          </Chip>
        )}
      </div>

      {error && <ErrorNote message={error} />}
      {!error && !loading && visible.length === 0 && <Empty>No jobs match. Try another search.</Empty>}
      <div className="grid gap-4 md:grid-cols-3">
        {visible.map((job) => (
          <JobTile key={job.id} job={job} />
        ))}
      </div>
      {loading && <Loading />}
      {cursor && !loading && (
        <Button small onClick={() => void load(cursor)} className="max-w-[200px] self-center">
          Load more
        </Button>
      )}
    </Page>
  )
}
