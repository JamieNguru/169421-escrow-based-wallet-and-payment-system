// The API stores photos as data URLs inside the job or dispute document and
// caps each at 300,000 characters, so photos are shrunk before they are sent.
const MAX_SIDE = 1024
const MAX_CHARS = 280_000

export async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. Try a JPEG or PNG.')
  }

  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser cannot resize images.')

  // Lower the quality, then the size, until the encoded photo fits.
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL('image/jpeg', quality)
      if (url.length <= MAX_CHARS) {
        bitmap.close()
        return url
      }
    }
    scale *= 0.75
  }
  bitmap.close()
  throw new Error('That photo is too large. Try a smaller one.')
}
