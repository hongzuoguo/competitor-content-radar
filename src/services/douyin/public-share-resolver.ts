import { findWorkRecordsFromPayload } from './discovery'
import { isRiskControlText } from './risk-control'
import { isSafeDouyinMediaUrl } from '../media/url-safety'
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5'

const SHARE_HOSTS = new Set(['iesdouyin.com', 'www.iesdouyin.com', 'douyin.com', 'www.douyin.com'])
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

export interface PublicDouyinVideo {
  videoId: string
  title: string
  downloadUrl: string | null
  authorName: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  coverUrl: string | null
  source: 'share_router' | 'detail_api' | 'share_page' | 'iteminfo_api'
}

export interface PublicShareResolverOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBodyBytes?: number
  report?(event: PublicShareDiagnostic): void
}

export interface PublicShareDiagnostic {
  videoId: string
  source: PublicDouyinVideo['source']
  outcome: 'success' | 'not_found' | 'request_failed'
  elapsedMs: number
}

interface PublicEndpoint {
  url: string
  source: PublicDouyinVideo['source']
  format: 'html' | 'json'
  knownLoaderOnly: boolean
}

class PublicShareError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'PublicShareError'
    this.code = code
  }
}

export class DouyinRiskControlError extends Error {
  readonly code = 'DOUYIN_RISK_CONTROL'

  constructor() {
    super('DOUYIN_RISK_CONTROL')
    this.name = 'DouyinRiskControlError'
  }
}

export async function resolvePublicDouyinVideo(
  videoId: string,
  options: PublicShareResolverOptions = {}
): Promise<PublicDouyinVideo | null> {
  if (!/^\d+$/.test(videoId)) throw new PublicShareError('INVALID_DOUYIN_VIDEO_ID')

  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const controller = new AbortController()
  const timeoutError = new PublicShareError('DOUYIN_PUBLIC_SHARE_TIMEOUT')
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)

  try {
    const endpoints: PublicEndpoint[] = [
      {
        url: `https://www.iesdouyin.com/share/video/${videoId}`,
        source: 'share_router',
        format: 'html',
        knownLoaderOnly: true
      },
      {
        url: `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383`,
        source: 'detail_api',
        format: 'json',
        knownLoaderOnly: false
      },
      {
        url: `https://www.douyin.com/share/video/${videoId}`,
        source: 'share_page',
        format: 'html',
        knownLoaderOnly: true
      },
      {
        url: `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoId}`,
        source: 'iteminfo_api',
        format: 'json',
        knownLoaderOnly: false
      }
    ]
    for (const endpoint of endpoints) {
      const startedAt = Date.now()
      let result: PublicDouyinVideo | null
      try {
        result = await resolveEndpoint(
          videoId,
          endpoint,
          fetcher,
          controller.signal,
          maxBodyBytes
        )
      } catch (error) {
        if (error instanceof EndpointRequestFailedError) {
          report(options.report, {
            videoId,
            source: endpoint.source,
            outcome: 'request_failed',
            elapsedMs: Date.now() - startedAt
          })
          continue
        }
        throw error
      }
      report(options.report, {
        videoId,
        source: endpoint.source,
        outcome: result ? 'success' : 'not_found',
        elapsedMs: Date.now() - startedAt
      })
      if (result) return result
    }
    return null
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeoutError) throw timeoutError
    if (error instanceof PublicShareError || error instanceof DouyinRiskControlError) throw error
    throw new PublicShareError('DOUYIN_PUBLIC_SHARE_REQUEST_FAILED')
  } finally {
    clearTimeout(timer)
  }
}

class EndpointRequestFailedError extends Error {}

async function resolveEndpoint(
  videoId: string,
  endpoint: PublicEndpoint,
  fetcher: typeof fetch,
  signal: AbortSignal,
  maxBodyBytes: number
): Promise<PublicDouyinVideo | null> {
  let response: Response
  try {
    response = await fetchWithRedirects(endpoint.url, fetcher, signal)
  } catch (error) {
    if (error instanceof PublicShareError || error instanceof DouyinRiskControlError) throw error
    throw new EndpointRequestFailedError()
  }
  if (response.bodyUsed) return null
  const expectedContentType = endpoint.format === 'html' ? isHtmlResponse : isJsonResponse
  if (!expectedContentType(response)) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  let body: string
  try {
    body = await readLimitedBody(response, maxBodyBytes)
  } catch (error) {
    if (error instanceof PublicShareError || error instanceof DouyinRiskControlError) throw error
    throw new EndpointRequestFailedError()
  }
  if (isRiskControlText(body)) throw new DouyinRiskControlError()
  if (!response.ok) return null
  let payload: unknown
  if (endpoint.format === 'html') {
    payload = parseRouterData(body)
  } else {
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      return null
    }
  }
  if (!payload) {
    const title = endpoint.source === 'share_page' ? parseSharePageTitle(body) : null
    return title ? metadataOnlyVideo(videoId, title) : null
  }
  if (isRiskControlText(JSON.stringify(payload))) throw new DouyinRiskControlError()
  const raw = endpoint.knownLoaderOnly
    ? findKnownLoaderWork(videoId, payload)
    : findWorkRecordsFromPayload(videoId, payload)[0] ?? null
  return raw ? toPublicVideo(videoId, raw, endpoint.source) : null
}

function report(
  reporter: PublicShareResolverOptions['report'],
  event: PublicShareDiagnostic
): void {
  try {
    reporter?.(event)
  } catch {
    // Diagnostics are best-effort and cannot change resolver behavior.
  }
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return /^text\/html(?:\s*;|\s*$)/i.test(contentType)
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return /^(?:application|text)\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(contentType)
}

async function fetchWithRedirects(
  initialUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<Response> {
  let currentUrl = new URL(initialUrl)
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(currentUrl.href, {
      credentials: 'omit',
      redirect: 'manual',
      signal,
      headers: { 'user-agent': MOBILE_USER_AGENT }
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response

    await response.body?.cancel().catch(() => undefined)
    if (redirects >= MAX_REDIRECTS) {
      throw new PublicShareError('DOUYIN_PUBLIC_SHARE_TOO_MANY_REDIRECTS')
    }
    const location = response.headers.get('location')
    let nextUrl: URL
    try {
      if (!location) throw new Error('missing location')
      nextUrl = new URL(location, currentUrl)
    } catch {
      throw new PublicShareError('DOUYIN_PUBLIC_SHARE_UNSAFE_REDIRECT')
    }
    if (!isAllowedShareUrl(nextUrl)) {
      throw new PublicShareError('DOUYIN_PUBLIC_SHARE_UNSAFE_REDIRECT')
    }
    currentUrl = nextUrl
  }
}

function isAllowedShareUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    SHARE_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port
  )
}

async function readLimitedBody(response: Response, maxBodyBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new PublicShareError('DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > maxBodyBytes) {
        await reader.cancel()
        throw new PublicShareError('DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function parseRouterData(html: string): unknown | null {
  let document: DefaultTreeAdapterMap['document']
  try {
    document = parse(html)
  } catch {
    return null
  }
  const scripts: string[] = []
  collectScriptText(document, scripts)
  for (const script of scripts) {
    const start = findRouterObjectStart(script)
    if (start < 0) continue
    const parsed = parseJsonObject(script, start)
    if (parsed) return parsed
  }
  return null
}

function parseSharePageTitle(html: string): string | null {
  let document: DefaultTreeAdapterMap['document']
  try {
    document = parse(html)
  } catch {
    return null
  }
  const metadata = new Map<string, string>()
  collectMetaContent(document, metadata)
  return metadata.get('og:title') ?? metadata.get('og:description') ?? metadata.get('description') ?? null
}

function collectMetaContent(
  node: DefaultTreeAdapterMap['node'],
  output: Map<string, string>
): void {
  if (defaultTreeAdapter.isElementNode(node) && defaultTreeAdapter.getTagName(node) === 'meta') {
    const attributes = new Map(
      defaultTreeAdapter.getAttrList(node).map((attribute) => [attribute.name.toLowerCase(), attribute.value])
    )
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').trim().toLowerCase()
    const content = attributes.get('content')?.trim()
    if (content && ['og:title', 'og:description', 'description'].includes(key) && !output.has(key)) {
      output.set(key, content)
    }
  }
  if (!('childNodes' in node)) return
  for (const child of node.childNodes) collectMetaContent(child, output)
}

function metadataOnlyVideo(videoId: string, title: string): PublicDouyinVideo {
  return {
    videoId,
    title,
    downloadUrl: null,
    authorName: null,
    likes: null,
    comments: null,
    shares: null,
    coverUrl: null,
    source: 'share_page'
  }
}

function collectScriptText(node: DefaultTreeAdapterMap['node'], output: string[]): void {
  if (defaultTreeAdapter.isElementNode(node) && defaultTreeAdapter.getTagName(node) === 'script') {
    const text = defaultTreeAdapter.getChildNodes(node)
      .filter((child) => defaultTreeAdapter.isTextNode(child))
      .map((child) => defaultTreeAdapter.getTextNodeContent(child))
      .join('')
    output.push(text)
    return
  }
  if (!('childNodes' in node)) return
  for (const child of node.childNodes) collectScriptText(child, output)
}

function findRouterObjectStart(script: string): number {
  const marker = 'window._ROUTER_DATA'
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code'
  let escaped = false

  for (let index = 0; index < script.length; index += 1) {
    const character = script[index]
    const next = script[index + 1]
    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'code'
        index += 1
      }
      continue
    }
    if (state !== 'code') {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (
        (state === 'single' && character === "'") ||
        (state === 'double' && character === '"') ||
        (state === 'template' && character === '`')
      ) state = 'code'
      continue
    }
    if (character === '/' && next === '/') {
      state = 'line-comment'
      index += 1
    } else if (character === '/' && next === '*') {
      state = 'block-comment'
      index += 1
    } else if (character === "'") state = 'single'
    else if (character === '"') state = 'double'
    else if (character === '`') state = 'template'
    else if (script.startsWith(marker, index)) {
      if (index > 0 && /[\w$.]/.test(script[index - 1])) continue
      let cursor = index + marker.length
      while (/\s/.test(script[cursor] ?? '')) cursor += 1
      if (script[cursor] !== '=') continue
      cursor += 1
      while (/\s/.test(script[cursor] ?? '')) cursor += 1
      if (script[cursor] === '{') return cursor
    }
  }
  return -1
}

function parseJsonObject(script: string, start: number): unknown | null {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < script.length; index += 1) {
    const character = script[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(script.slice(start, index + 1)) as unknown
      } catch {
        return null
      }
    }
  }
  return null
}

function findKnownLoaderWork(
  videoId: string,
  payload: unknown
): Record<string, unknown> | null {
  const loaderData = asRecord(asRecord(payload).loaderData)
  for (const key of ['video_(id)/page', 'note_(id)/page']) {
    const routeData = loaderData[key]
    if (routeData == null) continue
    const raw = findWorkRecordsFromPayload(videoId, routeData)[0]
    if (raw) return raw
  }
  return null
}

function toPublicVideo(
  videoId: string,
  raw: Record<string, unknown>,
  source: PublicDouyinVideo['source']
): PublicDouyinVideo {
  const statistics = asRecord(raw.statistics)
  const author = asRecord(raw.author)
  const video = asRecord(raw.video)
  const images = Array.isArray(raw.images) ? raw.images : []
  const firstImage = asRecord(images[0])

  return {
    videoId,
    title: stringValue(raw.desc) ?? stringValue(raw.title) ?? '',
    downloadUrl: safeMediaUrl(firstUrl(
      asRecord(video.play_addr),
      asRecord(video.playAddress),
      asRecord(video.download_addr),
      asRecord(video.downloadAddress)
    ), true),
    authorName: stringValue(author.nickname) ?? stringValue(author.name),
    likes: countValue(statistics.digg_count ?? statistics.like_count),
    comments: countValue(statistics.comment_count),
    shares: countValue(statistics.share_count),
    coverUrl: safeMediaUrl(firstUrl(
      asRecord(video.cover),
      asRecord(video.origin_cover),
      asRecord(video.originCover),
      firstImage
    ), false),
    source
  }
}

function firstUrl(...records: Record<string, unknown>[]): string | null {
  for (const record of records) {
    const urls = record.url_list ?? record.urlList
    if (Array.isArray(urls)) {
      const url = urls.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      if (url) return url
    }
  }
  return null
}

function safeMediaUrl(value: string | null, removeWatermark: boolean): string | null {
  if (!value || !isSafeDouyinMediaUrl(value)) return null
  try {
    const url = new URL(value)
    if (removeWatermark) {
      url.pathname = url.pathname
        .split('/')
        .map((segment) => segment === 'playwm' ? 'play' : segment)
        .join('/')
    }
    return url.href
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function countValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null
}
