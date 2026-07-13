const DIRECT_HOSTS = new Set(['douyin.com', 'www.douyin.com'])
const SHORT_HOST = 'v.douyin.com'

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
    if (/^\/user\/[^/]+$/.test(url.pathname) && modalIds.length === 1 && /^\d+$/.test(modalIds[0])) {
      return { kind: 'modal', videoId: modalIds[0], url }
    }
    return null
  }

  if (url.hostname === SHORT_HOST && /^\/[^/]+\/?$/.test(url.pathname)) {
    return { kind: 'short', url }
  }
  return null
}
