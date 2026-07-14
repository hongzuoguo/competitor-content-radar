export interface GetBijiBlogger {
  followId: string
  name: string
  profileUrl: string | null
}

export interface GetBijiContent {
  postId: string
  title: string
  publishedAt: string
  originalUrl: string | null
  metrics: { likes: number; comments: number; shares: number; collects: number }
}

export interface GetBijiContentDetail {
  postId: string
  transcript: string
  originalUrl: string | null
}

export class GetBijiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'GetBijiError'
  }
}

export interface GetBijiClientOptions {
  clientId: string
  apiKey: string
  topicId: string
  fetcher?: typeof fetch
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function text(record: JsonObject, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return null
}

function count(record: JsonObject, ...keys: string[]): number {
  const value = keys.map((key) => record[key]).find((candidate) => candidate !== undefined && candidate !== null)
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function list(data: JsonObject, ...keys: string[]): JsonObject[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value.map(object)
  }
  return []
}

function normalizePublishedAt(value: string | null): string {
  if (!value) return new Date(0).toISOString()
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}+08:00`
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

export class GetBijiClient {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: GetBijiClientOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  async listBloggers(): Promise<GetBijiBlogger[]> {
    const items = await this.listPages('/open/api/v1/resource/knowledge/bloggers', {}, ['bloggers', 'follows', 'list'])
    return items.flatMap((item) => {
      const followId = text(item, 'follow_id', 'followId', 'id')
      if (!followId) return []
      return [{
        followId,
        name: text(item, 'nickname', 'name', 'blogger_name', 'title') ?? `博主 ${followId}`,
        profileUrl: text(item, 'profile_url', 'profileUrl', 'homepage_url', 'url')
      }]
    })
  }

  async listContents(followId: string): Promise<GetBijiContent[]> {
    const items = await this.listPages(
      '/open/api/v1/resource/knowledge/blogger/contents', { follow_id: followId }, ['contents', 'posts', 'list']
    )
    return items.flatMap((item) => {
      const postId = text(item, 'post_id_alias', 'post_id', 'postId', 'id')
      if (!postId) return []
      return [{
        postId,
        title: text(item, 'title', 'desc', 'description') ?? '抖音作品',
        publishedAt: normalizePublishedAt(text(item, 'published_at', 'publish_time', 'created_at', 'create_time')),
        originalUrl: text(item, 'original_url', 'share_url', 'url'),
        metrics: {
          likes: count(item, 'like_count', 'likes', 'digg_count'),
          comments: count(item, 'comment_count', 'comments'),
          shares: count(item, 'share_count', 'shares'),
          collects: count(item, 'collect_count', 'collects', 'favorite_count')
        }
      }]
    })
  }

  async getContentDetail(postId: string): Promise<GetBijiContentDetail> {
    const data = await this.get('/open/api/v1/resource/knowledge/blogger/content/detail', { post_id: postId })
    const detail = object(data.content ?? data.post ?? data.detail ?? data)
    const transcript = text(detail, 'original', 'transcript', 'content', 'text')
      ?? text(object(detail.audio), 'original', 'transcript')
    if (!transcript) throw new GetBijiError('GET_BIJI_TRANSCRIPT_MISSING', '该作品暂时没有可用文字稿。')
    return {
      postId: text(detail, 'post_id_alias', 'post_id', 'postId', 'id') ?? postId,
      transcript,
      originalUrl: text(detail, 'original_url', 'share_url', 'url')
    }
  }

  private async get(path: string, query: Record<string, string>): Promise<JsonObject> {
    const url = new URL(path, 'https://openapi.biji.com')
    url.searchParams.set('topic_id', this.options.topicId)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    let response: Response
    try {
      response = await this.fetcher(url.toString(), {
        method: 'GET',
        headers: { Authorization: this.options.apiKey, 'X-Client-ID': this.options.clientId, Accept: 'application/json' }
      })
    } catch {
      throw new GetBijiError('GET_BIJI_NETWORK_FAILED', '无法连接得到大脑，请检查网络后重试。')
    }
    if (response.status === 401 || response.status === 403) {
      throw new GetBijiError('GET_BIJI_AUTH_FAILED', '得到大脑凭证无效，请检查 Client ID 和 API Key。')
    }
    if (response.status === 429) throw new GetBijiError('GET_BIJI_RATE_LIMITED', '得到大脑请求过于频繁，请稍后重试。')
    if (!response.ok) throw new GetBijiError('GET_BIJI_REQUEST_FAILED', `得到大脑同步失败（${response.status}）。`)
    const payload = object(await response.json())
    if (payload.success === false) {
      throw new GetBijiError('GET_BIJI_REQUEST_FAILED', text(payload, 'message', 'msg') ?? '得到大脑同步失败。')
    }
    return object(payload.data)
  }

  private async listPages(path: string, query: Record<string, string>, keys: string[]): Promise<JsonObject[]> {
    const output: JsonObject[] = []
    for (let page = 1; page <= 10; page += 1) {
      const data = await this.get(path, { ...query, page: String(page) })
      const pageItems = list(data, ...keys)
      output.push(...pageItems)
      const hasMore = data.has_more ?? data.hasMore
      if (hasMore === false || pageItems.length === 0 || (hasMore === undefined && pageItems.length < 20)) break
    }
    return output
  }
}
