import type { Work } from '../../core/domain'
import type { ScraplingEngineManager } from './manager'
import type { ScraplingEngineRunner } from './runner'

type PrimaryCapture = (creatorId: string, profileUrl: string) => Promise<Work[]>

export class ScraplingFallbackCollector {
  constructor(
    private readonly manager: Pick<ScraplingEngineManager, 'ensureInstalled'>,
    private readonly runner: Pick<ScraplingEngineRunner, 'captureCreator'>,
    private readonly profileDirectory: string,
    private readonly report?: (message: string, detail?: Record<string, unknown>) => void
  ) {}

  async capture(
    creatorId: string,
    profileUrl: string,
    primaryCapture: PrimaryCapture
  ): Promise<Work[]> {
    try {
      const primary = await primaryCapture(creatorId, profileUrl)
      if (primary.length > 0) return primary
      this.report?.('主采集未返回作品，启用本地备用采集引擎', { creatorId })
    } catch (error) {
      if (!isFallbackEligible(error)) throw error
      this.report?.('主采集失败，启用本地备用采集引擎', {
        creatorId,
        errorCode: stableCode(error)
      })
    }

    const executablePath = await this.manager.ensureInstalled()
    const result = await this.runner.captureCreator(executablePath, {
      command: 'capture_creator', creatorId, profileUrl,
      profileDirectory: this.profileDirectory
    })
    return result.works.map((work) => ({
      id: `douyin:${work.id}`,
      creatorId,
      platformWorkId: work.id,
      sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${work.id}`,
      mediaPath: null,
      title: work.title,
      publishedAt: work.publishedAt,
      originalUrl: work.originalUrl,
      downloadUrl: work.downloadUrl,
      metrics: {
        likes: work.likes,
        comments: work.comments,
        shares: work.shares,
        collects: work.collects
      }
    }))
  }
}

function isFallbackEligible(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return true
  return !['INVALID_DOUYIN_CREATOR_URL', 'INVALID_DOUYIN_VIDEO_CAPTURE_REQUEST'].includes(String(error.code))
}

function stableCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'DOUYIN_PRIMARY_CAPTURE_FAILED'
}
