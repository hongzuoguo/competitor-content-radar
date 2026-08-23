const ALLOWED_HOSTS = new Set([
  'douyin.com',
  'www.douyin.com',
  'v.douyin.com',
  'iesdouyin.com',
  'www.iesdouyin.com'
])
const MAX_REDIRECTS = 5

export type CreatorRedirectFetch = (
  url: string,
  options: { redirect: 'manual' }
) => Promise<Pick<Response, 'status' | 'headers'>>

function isAllowedUrl(url: URL): boolean {
  return url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    ALLOWED_HOSTS.has(url.hostname.toLowerCase())
}

function extractCreatorUrl(input: string): URL {
  const matches = input.match(/https:\/\/[^\s<>"']+/giu) ?? []
  const candidates = matches.flatMap((match) => {
    try {
      const url = new URL(match.replace(/[.,!?，。！？；;）)\]}]+$/u, ''))
      return isAllowedUrl(url) ? [url] : []
    } catch {
      return []
    }
  })
  if (candidates.length !== 1) throw new Error('INVALID_DOUYIN_CREATOR_URL')
  return candidates[0]
}

function normalizeProfileUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/(?:share\/)?user\/([^/]+)\/?$/u)
  if (!match) return null
  return `https://www.douyin.com/user/${match[1]}`
}

export async function resolveDouyinCreatorUrl(
  input: string,
  fetchRedirect: CreatorRedirectFetch
): Promise<string> {
  let current = extractCreatorUrl(input)

  for (let redirects = 0; redirects < MAX_REDIRECTS; redirects += 1) {
    const normalized = normalizeProfileUrl(current)
    if (normalized) return normalized
    if (current.hostname.toLowerCase() !== 'v.douyin.com') {
      throw new Error('INVALID_DOUYIN_CREATOR_URL')
    }

    const response = await fetchRedirect(current.toString(), { redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      throw new Error('INVALID_DOUYIN_CREATOR_URL')
    }

    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      throw new Error('UNSAFE_DOUYIN_CREATOR_REDIRECT')
    }
    if (!isAllowedUrl(next)) throw new Error('UNSAFE_DOUYIN_CREATOR_REDIRECT')
    current = next
  }

  throw new Error('DOUYIN_CREATOR_REDIRECT_LIMIT')
}
