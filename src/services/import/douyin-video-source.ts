import { ImportError } from './import-errors'
import { parseDouyinWorkUrl } from '../../shared/douyin-work-url'

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
  const parsed = parseDouyinWorkUrl(input)
  if (!parsed || parsed.kind === 'short') throw new Error('INVALID_DOUYIN_VIDEO_URL')
  const videoId = parsed.videoId
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
  const parsed = parseDouyinWorkUrl(input)
  if (!parsed) throw new Error('INVALID_DOUYIN_VIDEO_URL')
  if (parsed.kind !== 'short') return normalizeDouyinVideoUrl(input)

  let current = parsed.url
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
    try {
      if (response.status < 300 || response.status > 399) throw new Error('DOUYIN_SHORT_URL_STATUS_INVALID')
      const location = response.headers.get('location')
      if (!location) throw new Error('DOUYIN_SHORT_URL_LOCATION_MISSING')
      const next = new URL(location, current)
      const parsedNext = parseDouyinWorkUrl(next.toString())
      if (!parsedNext) throw new Error('DOUYIN_SHORT_URL_HOST_INVALID')
      if (parsedNext.kind !== 'short') return normalizeDouyinVideoUrl(next.toString())
      current = parsedNext.url
    } finally {
      await cancelResponseBody(response)
    }
  }
  throw new Error('DOUYIN_SHORT_URL_REDIRECT_LIMIT')
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Releasing a response is best-effort and must not mask URL validation failures.
  }
}

function unavailableError(cause: unknown): ImportError {
  return new ImportError(
    'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE',
    '暂时无法获取该抖音视频，请下载视频后从本地上传。',
    { action: 'upload_local', retryable: false, cause }
  )
}
