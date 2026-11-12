const BASE = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null

export const setToken = (value: string | null) => {
  token = value
}

// Called when a signed-in request comes back 401 (expired or invalid token).
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler
}

export async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.()
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Something went wrong')
  }
  return data as T
}

export const get = <T>(path: string, query?: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return http<T>('GET', qs ? `${path}?${qs}` : path)
}

export const post = <T = unknown>(path: string, body?: unknown) => http<T>('POST', path, body ?? {})
export const patch = <T>(path: string, body: unknown) => http<T>('PATCH', path, body)
