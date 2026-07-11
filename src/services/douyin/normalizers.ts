import type { Work } from '../../core/domain'

const RECENT_WINDOW_MS = 120 * 60 * 60 * 1000

function finiteCount(value: unknown): number {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
}

export function normalizeCreatorUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('INVALID_DOUYIN_CREATOR_URL')
  }
  if (
    url.protocol !== 'https:' ||
    !['douyin.com', 'www.douyin.com'].includes(url.hostname) ||
    !/^\/user\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new Error('INVALID_DOUYIN_CREATOR_URL')
  }
  return `https://www.douyin.com${url.pathname.replace(/\/$/, '')}`
}

export function normalizeDouyinWork(
  creatorId: string,
  raw: Record<string, unknown>
): Work {
  const platformWorkId = String(raw.aweme_id ?? raw.awemeId ?? raw.id ?? '')
  if (!platformWorkId) throw new Error('DOUYIN_WORK_ID_MISSING')
  const statistics = (raw.statistics ?? {}) as Record<string, unknown>
  const video = (raw.video ?? {}) as Record<string, unknown>
  const playAddress = (video.play_addr ?? video.playAddress ?? {}) as Record<string, unknown>
  const downloadAddress = (video.download_addr ?? video.downloadAddress ?? {}) as Record<
    string,
    unknown
  >
  const urls = (playAddress.url_list ?? downloadAddress.url_list ?? []) as unknown[]
  const timestampSeconds = finiteCount(raw.create_time ?? raw.createTime)

  return {
    id: `douyin:${platformWorkId}`,
    creatorId,
    platformWorkId,
    title: String(raw.desc ?? raw.title ?? '未命名作品'),
    publishedAt: new Date(timestampSeconds * 1000).toISOString(),
    originalUrl: `https://www.douyin.com/video/${platformWorkId}`,
    downloadUrl: typeof urls[0] === 'string' ? urls[0] : null,
    metrics: {
      likes: finiteCount(statistics.digg_count ?? statistics.like_count),
      comments: finiteCount(statistics.comment_count),
      shares: finiteCount(statistics.share_count),
      collects: finiteCount(statistics.collect_count)
    }
  }
}

export function deduplicateWorks(works: readonly Work[]): Work[] {
  const byPlatformId = new Map<string, Work>()
  for (const work of works) byPlatformId.set(work.platformWorkId, work)
  return [...byPlatformId.values()]
}

function newestFirst(works: readonly Work[]): Work[] {
  return [...works].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  )
}

export function selectBaselineWorks(works: readonly Work[]): Work[] {
  return newestFirst(deduplicateWorks(works)).slice(0, 30)
}

export function selectRecentWorks(works: readonly Work[], now = new Date()): Work[] {
  return newestFirst(deduplicateWorks(works)).filter((work) => {
    const age = now.getTime() - Date.parse(work.publishedAt)
    return age >= 0 && age <= RECENT_WINDOW_MS
  })
}
