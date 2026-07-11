import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function downloadMedia(
  url: string,
  destination: string,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const offset = existsSync(destination) ? statSync(destination).size : 0
  const response = await fetchImplementation(url, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
  })
  if (!response.ok || !response.body) throw new Error(`MEDIA_DOWNLOAD_HTTP_${response.status}`)

  const append = offset > 0 && response.status === 206
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination, { flags: append ? 'a' : 'w' })
  )
}
