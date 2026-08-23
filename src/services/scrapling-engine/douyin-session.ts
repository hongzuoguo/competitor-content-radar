import type { CreatorDiscoveryResult } from '../douyin/discovery'
import type { WorkOwnership } from '../../core/domain'
import type { ScraplingEngineManager } from './manager'
import type { ScraplingEngineRunner } from './runner'

export class ScraplingDouyinSession {
  constructor(
    private readonly manager: Pick<ScraplingEngineManager, 'ensureInstalled'>,
    private readonly runner: Pick<ScraplingEngineRunner, 'captureCreator' | 'captureVideo' | 'login' | 'loginStatus'>,
    private readonly profileDirectory: string,
    private readonly report?: (message: string, detail?: Record<string, unknown>) => void,
    private readonly launchLoginBrowser?: (profileDirectory: string) => Promise<void>,
    private readonly prepareCapture?: (profileDirectory: string) => Promise<void>,
    private readonly removeProfile?: (profileDirectory: string) => Promise<void>
  ) {}

  async login(): Promise<void> {
    if (this.launchLoginBrowser) {
      await this.launchLoginBrowser(this.profileDirectory)
      return
    }
    const command = await this.manager.ensureInstalled()
    await this.runner.login(command, this.profileDirectory)
  }

  async logout(): Promise<void> {
    this.report?.('Clearing Douyin login session', { profileDirectory: this.profileDirectory })
    if (!this.removeProfile) throw new Error('DOUYIN_LOGOUT_UNAVAILABLE')
    await this.removeProfile(this.profileDirectory)
  }

  async isLoggedIn(): Promise<boolean> {
    const command = await this.manager.ensureInstalled()
    return (await this.runner.loginStatus(command, this.profileDirectory)).loggedIn
  }

  async captureCreator(creatorId: string, profileUrl: string, ownership: WorkOwnership = 'competitor'): Promise<CreatorDiscoveryResult> {
    this.report?.('Starting Scrapling creator capture', { creatorId })
    await this.prepareCapture?.(this.profileDirectory)
    const command = await this.manager.ensureInstalled()
    const result = await this.runner.captureCreator(command, {
      command: 'capture_creator',
      creatorId,
      profileUrl,
      profileDirectory: this.profileDirectory
    })
    return {
      creator: result.creator,
      works: result.works.map((work) => ({
        id: `douyin:${work.id}`,
        creatorId,
        platformWorkId: work.id,
        sourceType: 'douyin_monitor' as const,
        ownership,
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

  async captureSingleVideo(videoId: string, url: string): Promise<{ title: string; downloadUrl: string | null } | null> {
    const canonicalUrl = `https://www.douyin.com/video/${videoId}`
    if (url !== canonicalUrl || !/^\d+$/.test(videoId)) throw new Error('INVALID_DOUYIN_VIDEO_CAPTURE_REQUEST')
    await this.prepareCapture?.(this.profileDirectory)
    const command = await this.manager.ensureInstalled()
    const work = await this.runner.captureVideo(command, this.profileDirectory, videoId)
    return { title: work.title, downloadUrl: work.downloadUrl }
  }
}
