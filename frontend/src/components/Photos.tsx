import { useRef, useState } from 'react'

import { fileToDataUrl } from '../lib/images'
import Icon from './Icon'

export const MAX_PHOTOS = 3

// Pick up to three photos; each is shrunk in the browser before it is kept.
export function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (next: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    setBusy(true)
    try {
      const room = MAX_PHOTOS - photos.length
      const added = await Promise.all(Array.from(files).slice(0, room).map(fileToDataUrl))
      onChange([...photos, ...added])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the photo')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2.5">
        {photos.map((src, i) => (
          <div key={i} className="relative h-24 w-24 overflow-hidden rounded-2xl border border-line shadow-sm">
            <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-sm font-bold text-white"
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed border-neutral-300 bg-neutral-50 text-[13px] font-medium text-neutral-500 transition hover:border-brand hover:bg-brand-tint hover:text-brand-ink disabled:opacity-50"
          >
            <Icon name="upload" />
            {busy ? 'Adding…' : 'Add photo'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
      <div className="mt-1.5 text-[13px] text-muted">Up to {MAX_PHOTOS} photos. They are resized before sending.</div>
      {error && <div role="alert" className="mt-1.5 text-[13px] text-danger">{error}</div>}
    </div>
  )
}

// Read-only thumbnails; click one to open it full size in a new tab.
export function PhotoGallery({ photos }: { photos: string[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {photos.map((src, i) => (
        <a key={i} href={src} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-2xl border border-line shadow-sm">
          <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  )
}
