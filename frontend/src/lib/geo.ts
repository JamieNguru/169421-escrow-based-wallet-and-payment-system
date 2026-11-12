export interface Position {
  lat: number
  lng: number
}

// The browser's current position, with errors worded for the person using the app.
export function getPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Your browser cannot share your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked. Allow it in your browser settings to use this.'
              : 'We could not find your location. Try again.',
          ),
        ),
      { timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

type Address = Partial<Record<string, string>>

// Administrative suffixes OpenStreetMap adds to East African place names ("Kilimani ward").
const ADMIN_SUFFIX = /\s+(ward|division|location|sub-location|sub-county|municipal|county)$/i
const clean = (name?: string) => name?.replace(ADMIN_SUFFIX, '').trim() || undefined

// A short place label such as "Kilimani, Nairobi" from an OpenStreetMap address:
// the local area (or the road, if there is none) and the town it is in.
export function labelFromAddress(address: Address): string | undefined {
  const area =
    clean(address.neighbourhood ?? address.suburb ?? address.quarter ?? address.village ?? address.hamlet) ?? address.road
  // Some places come back with a ward as the "city"; skip those and use the next level up.
  const townRaw = [address.city, address.town, address.municipality, address.county, address.state].find(
    (v) => v && !/\sward$/i.test(v),
  )
  const town = clean(townRaw)
  const parts = [area, town].filter((p): p is string => Boolean(p))
  const unique = parts.filter((p, i) => parts.indexOf(p) === i)
  return unique.length ? unique.join(', ').slice(0, 120) : undefined
}

// The place name for a position, from OpenStreetMap's Nominatim service. Undefined when
// the lookup fails, so the caller can fall back to something else.
export async function placeName(pos: Position): Promise<string | undefined> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=en` +
    `&lat=${pos.lat}&lon=${pos.lng}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return undefined
    const body = (await res.json()) as { address?: Address }
    return body.address ? labelFromAddress(body.address) : undefined
  } catch {
    return undefined
  }
}

// Used when no place name can be found, so the position is still saved with the job.
export const coordinatesLabel = (pos: Position) => `Near ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`
