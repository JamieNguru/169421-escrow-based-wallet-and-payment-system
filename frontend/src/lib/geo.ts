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
