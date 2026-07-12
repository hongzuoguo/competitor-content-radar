import { ImportError } from './import-errors'

const DIRECT_HOSTS = new Set(['douyin.com', 'www.douyin.com'])
const SHORT_HOST = 'v.douyin.com'
const MAX_SHORT_LINK_REDIRECTS = 5

export interface NormalizedDouyinVideoUrl {
  videoId: string
  canonicalUrl: string
}

export interface CapturedDouyinVideo {
  title: string
  downloadUrl: string | null
}

export interface DouyinVideoCapturePort {
  captureSingleVideo(videoId: string, url: string): Promise<CapturedDouyinVideo | null>
}

export interface DouyinVideoDescriptor {
  sourceType: 'douyin_url'
  sourceKey: string
  title: string
  originalUrl: string
  downloadUrl: string
}

export type ShortLinkResolver = (input: string, init: RequestInit) => Promise<Response>

export function normalizeDouyinVideoUrl(input: string): NormalizedDouyinVideoUrl {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('INVALID_DOUYIN_VIDEO_URL')
  }
  const match = /^\/video\/(\d+)\/?$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !DIRECT_HOSTS.has(url.hostname) ||
    !match
  ) {
    throw new Error('INVALID_DOUYIN_VIDEO_URL')
  }
  const videoId = match[1]
  return { videoId, canonicalUrl: `https://www.douyin.com/video/${videoId}` }
}

export async function resolveDouyinVideo(
  input: string,
  capturePort: DouyinVideoCapturePort,
  shortLinkResolver: ShortLinkResolver = fetch
): Promise<DouyinVideoDescriptor> {
  try {
    const normalized = await resolveInputUrl(input, shortLinkResolver)
    const captured = await capturePort.captureSingleVideo(normalized.videoId, normalized.canonicalUrl)
    if (!captured?.downloadUrl) throw new Error('DOUYIN_VIDEO_DOWNLOAD_MISSING')
    return {
      sourceType: 'douyin_url',
      sourceKey: `douyin:${normalized.videoId}`,
      title: captured.title,
      originalUrl: normalized.canonicalUrl,
      downloadUrl: captured.downloadUrl
    }
  } catch (cause) {
    throw unavailableError(cause)
  }
}

async function resolveInputUrl(input: string, resolver: ShortLinkResolver): Promise<NormalizedDouyinVideoUrl> {
  let initial: URL
  try {
    initial = new URL(input.trim())
  } catch {
    throw new Error('INVALID_DOUYIN_VIDEO_URL')
  }
  if (initial.hostname !== SHORT_HOST) return normalizeDouyinVideoUrl(input)
  if (
    initial.protocol !== 'https:' ||
    initial.port !== '' ||
    initial.username !== '' ||
    initial.password !== '' ||
    !/^\/[^/]+\/?$/.test(initial.pathname)
  ) {
    throw new Error('INVALID_DOUYIN_SHORT_URL')
  }

  let current = initial
  const visited = new Set<string>()
  for (let redirect = 0; redirect < MAX_SHORT_LINK_REDIRECTS; redirect += 1) {
    const requestUrl = current.toString()
    if (visited.has(requestUrl)) throw new Error('DOUYIN_SHORT_URL_LOOP')
    visited.add(requestUrl)
    const response = await resolver(requestUrl, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000)
    })
    const location = response.headers.get('location')
    if (!location) throw new Error('DOUYIN_SHORT_URL_LOCATION_MISSING')
    const next = new URL(location, current)
    if (DIRECT_HOSTS.has(next.hostname)) return normalizeDouyinVideoUrl(next.toString())
    if (
      next.protocol !== 'https:' ||
      next.port !== '' ||
      next.username !== '' ||
      next.password !== '' ||
      next.hostname !== SHORT_HOST
    ) throw new Error('DOUYIN_SHORT_URL_HOST_INVALID')
    current = next
  }
  throw new Error('DOUYIN_SHORT_URL_REDIRECT_LIMIT')
}

function unavailableError(cause: unknown): ImportError {
  return new ImportError(
    'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE',
    '暂时无法获取该抖音视频，请下载视频后从本地上传。',
    { action: 'upload_local', retryable: false, cause }
  )
}
