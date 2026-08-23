const DIRECT_HOSTS = new Set(['douyin.com', 'www.douyin.com'])
const SHORT_HOST = 'v.douyin.com'
const MAX_DOUYIN_SHARE_TEXT_LENGTH = 20_000

export type ParsedDouyinWorkUrl =
  | { kind: 'direct'; videoId: string; url: URL }
  | { kind: 'modal'; videoId: string; url: URL }
  | { kind: 'short'; url: URL }

export function parseDouyinWorkUrl(input: string): ParsedDouyinWorkUrl | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null

  if (DIRECT_HOSTS.has(url.hostname)) {
    const directMatch = /^\/video\/(\d+)\/?$/.exec(url.pathname)
    if (directMatch) return { kind: 'direct', videoId: directMatch[1], url }

    const modalIds = url.searchParams.getAll('modal_id')
    const modalPath = /^\/user\/[^/]+$/.test(url.pathname) || /^\/(?:jingxuan|search)(?:\/.*)?$/.test(url.pathname)
    if (modalPath && modalIds.length === 1 && /^\d+$/.test(modalIds[0])) {
      return { kind: 'modal', videoId: modalIds[0], url }
    }
    return null
  }

  if (url.hostname === SHORT_HOST && /^\/[^/]+\/?$/.test(url.pathname)) {
    return { kind: 'short', url }
  }
  return null
}

export function extractDouyinWorkUrl(input: string): string | null {
  if (input.length > MAX_DOUYIN_SHARE_TEXT_LENGTH) return null

  for (const scheme of input.matchAll(/https?:\/\//giu)) {
    const remainder = input.slice(scheme.index)
    const boundaryIndex = remainder.search(/[\s<>"'，。；：！？、（）【】《》「」『』]/u)
    const candidate = boundaryIndex === -1 ? remainder : remainder.slice(0, boundaryIndex)
    const queryIndex = candidate.search(/[?#]/u)
    const path = queryIndex === -1 ? candidate : candidate.slice(0, queryIndex)
    for (const punctuation of path.matchAll(/[,;!]/gu)) {
      const parsed = parseDouyinWorkUrl(candidate.slice(0, punctuation.index))
      if (parsed) return parsed.url.toString()
    }
    const cleaned = candidate.replace(/[,.;:!?，。；：！？、）】》」』)\]}]+$/u, '')
    const parsed = parseDouyinWorkUrl(cleaned)
    if (parsed) return parsed.url.toString()
  }
  return null
}
