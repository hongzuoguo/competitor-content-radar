import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createTransportRetryFetcher } from '../network/fetch-with-transport-retry'
import { isSafeDouyinMediaUrl } from './url-safety'

const MAX_MEDIA_REDIRECTS = 3

class MediaDownloadError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'MediaDownloadError'
    this.code = code
  }
}

export async function downloadMedia(
  url: string,
  destination: string,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  if (!isSafeDouyinMediaUrl(url)) throw new MediaDownloadError('UNSAFE_MEDIA_URL')
  await mkdir(dirname(destination), { recursive: true })
  const offset = existsSync(destination) ? statSync(destination).size : 0
  const response = await fetchMedia(url, offset, fetchImplementation)
  if (!response.ok || !response.body) throw new Error(`MEDIA_DOWNLOAD_HTTP_${response.status}`)

  const append = offset > 0 && response.status === 206
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination, { flags: append ? 'a' : 'w' })
  )
}

async function fetchMedia(
  initialUrl: string,
  offset: number,
  fetchImplementation: typeof fetch
): Promise<Response> {
  let currentUrl = new URL(initialUrl)
  const fetchWithRetry = createTransportRetryFetcher(fetchImplementation)
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchWithRetry(currentUrl.href, {
      credentials: 'omit',
      redirect: 'manual',
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response

    await response.body?.cancel().catch(() => undefined)
    if (redirects >= MAX_MEDIA_REDIRECTS) {
      throw new MediaDownloadError('MEDIA_DOWNLOAD_TOO_MANY_REDIRECTS')
    }
    const location = response.headers.get('location')
    let nextUrl: URL
    try {
      if (!location) throw new MediaDownloadError('MEDIA_DOWNLOAD_INVALID_REDIRECT')
      nextUrl = new URL(location, currentUrl)
    } catch (error) {
      if (error instanceof MediaDownloadError) throw error
      throw new MediaDownloadError('MEDIA_DOWNLOAD_INVALID_REDIRECT')
    }
    if (!isSafeDouyinMediaUrl(nextUrl.href)) throw new MediaDownloadError('UNSAFE_MEDIA_URL')
    currentUrl = nextUrl
  }
}
