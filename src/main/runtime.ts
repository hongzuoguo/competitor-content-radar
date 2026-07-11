import { randomUUID } from 'node:crypto'
import type { Work } from '../core/domain'
import { calculateEngagement, evaluateHighlight } from '../core/highlight-rules'
import { nextDailyRun } from './scheduler'
import { normalizeCreatorUrl, selectBaselineWorks, selectRecentWorks } from '../services/douyin/normalizers'
import { AppRepositories, type AnalysisRecord } from '../services/database/repositories'
import type { AppDatabase } from '../services/database/database'
import type { CreatorView, DashboardData, PublicSettings } from '../shared/ipc-contract'

export interface ProcessedWork {
  transcript: string
  result: Record<string, unknown>
  provider: string
  model: string
  promptVersion: string
  tokenUsage: Record<string, number> | null
}

export interface RuntimePorts {
  discover(creatorId: string, profileUrl: string): Promise<Work[]>
  processWork(work: Work, settings: PublicSettings): Promise<ProcessedWork>
  login(): Promise<void>
  saveApiKey?(providerId: string, apiKey: string): Promise<void> | void
}

const EMPTY_STAGES = [
  { id: 'discovery', label: '采集', status: 'pending' as const },
  { id: 'download', label: '下载', status: 'pending' as const },
  { id: 'transcription', label: '转写', status: 'pending' as const },
  { id: 'analysis', label: 'AI 拆解', status: 'pending' as const },
  { id: 'feishu', label: '飞书同步', status: 'pending' as const }
]

export class DesktopRuntime {
  private readonly repositories: AppRepositories
  private running = false
  private lastRunAt: string | null = null
  private runState: DashboardData['run'] = {
    status: 'idle',
    message: '等待下一次自动运行',
    requiresAction: false,
    stages: EMPTY_STAGES
  }

  constructor(
    private readonly database: AppDatabase,
    private readonly ports: RuntimePorts
  ) {
    this.repositories = new AppRepositories(database.connection)
  }

  async listCreators(): Promise<CreatorView[]> {
    return this.repositories.creators.list().map((creator) => ({
      id: creator.id,
      name: creator.name,
      profileUrl: creator.profileUrl,
      enabled: creator.enabled,
      works: this.repositories.works.listByCreator(creator.id).length,
      lastRun: this.lastRunAt ? new Date(this.lastRunAt).toLocaleString('zh-CN', { hour12: false }) : '尚未采集',
      status: this.lastRunAt ? 'ready' : 'waiting'
    }))
  }

  async addCreator(input: string): Promise<CreatorView> {
    const creators = this.repositories.creators.list()
    if (creators.length >= 10) throw new Error('CREATOR_LIMIT_REACHED')
    const profileUrl = normalizeCreatorUrl(input)
    const handle = profileUrl.split('/').at(-1) ?? '新博主'
    const creator = {
      id: randomUUID(),
      platform: 'douyin' as const,
      name: `@${handle.slice(0, 18)}`,
      profileUrl,
      enabled: true,
      createdAt: new Date().toISOString()
    }
    this.repositories.creators.create(creator)
    return { ...creator, works: 0, lastRun: '尚未采集', status: 'waiting' }
  }

  async toggleCreator(id: string, enabled: boolean): Promise<void> {
    this.repositories.creators.setEnabled(id, enabled)
  }

  async getSettings(): Promise<PublicSettings> {
    return this.repositories.settings.get<PublicSettings>('app.publicSettings') ?? {
      dailyTime: '09:00', weeklyTime: '09:30', absoluteLikes: 10_000,
      relativeViralIndex: 150, referenceValueScore: 80, mediaRetentionDays: 7
    }
  }

  async saveSettings(settings: Partial<PublicSettings> & { apiKey?: string }): Promise<PublicSettings> {
    const { apiKey, ...publicSettings } = settings
    if (apiKey && publicSettings.providerId) {
      await this.ports.saveApiKey?.(publicSettings.providerId, apiKey)
    }
    const merged = { ...(await this.getSettings()), ...publicSettings }
    this.repositories.settings.set('app.publicSettings', merged)
    return merged
  }

  async loginDouyin(): Promise<void> {
    await this.ports.login()
    await this.saveSettings({ douyinLoggedIn: true })
  }

  async runNow(): Promise<{ accepted: boolean; reason?: string }> {
    if (this.running) return { accepted: false, reason: '已有任务正在运行' }
    const settings = await this.getSettings()
    const creators = this.repositories.creators.list().filter((creator) => creator.enabled)
    if (creators.length === 0) return { accepted: false, reason: '请先添加至少一位博主' }
    if (!settings.providerId || !settings.modelId) return { accepted: false, reason: '请先完成 AI 模型设置' }

    this.running = true
    this.runState = {
      status: 'running', message: '正在采集公开作品，暂时无需操作', requiresAction: false,
      stages: EMPTY_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'running' as const : 'pending' as const }))
    }
    try {
      for (const creator of creators) {
        const discovered = selectBaselineWorks(await this.ports.discover(creator.id, creator.profileUrl))
        for (const work of discovered) {
          this.repositories.works.upsert(work)
          this.repositories.snapshots.create({
            id: randomUUID(), workId: work.id, capturedAt: new Date().toISOString(), metrics: work.metrics
          })
        }
        for (const work of selectRecentWorks(discovered)) {
          if (this.repositories.analyses.get(work.id)) continue
          const processed = await this.ports.processWork(work, settings)
          const analysis: AnalysisRecord = {
            workId: work.id,
            transcript: processed.transcript,
            result: processed.result,
            provider: processed.provider,
            model: processed.model,
            promptVersion: processed.promptVersion,
            tokenUsage: processed.tokenUsage,
            createdAt: new Date().toISOString()
          }
          this.repositories.analyses.save(analysis)
        }
      }
      this.lastRunAt = new Date().toISOString()
      const feishuConnected = settings.feishuConnected === true
      this.runState = {
        status: 'completed',
        message: feishuConnected ? '本次采集、转写、分析和同步已完成' : '本地采集、转写和分析已完成；飞书尚未连接',
        requiresAction: false,
        stages: EMPTY_STAGES.map((stage) => ({ ...stage, status: stage.id === 'feishu' && !feishuConnected ? 'pending' as const : 'completed' as const }))
      }
      return { accepted: true }
    } catch (error) {
      this.runState = {
        status: 'failed', message: error instanceof Error ? error.message : '任务失败', requiresAction: true,
        stages: this.runState.stages
      }
      throw error
    } finally {
      this.running = false
    }
  }

  async getDashboard(): Promise<DashboardData> {
    const settings = await this.getSettings()
    const creators = this.repositories.creators.list()
    const allWorks = this.repositories.works.listAll()
    const recentWorks = selectRecentWorks(allWorks)
    const highlights = recentWorks.flatMap((work) => {
      const analysis = this.repositories.analyses.get(work.id)
      const score = analysis ? Number(analysis.result.referenceValueScore ?? 0) : null
      const baseline = allWorks
        .filter((candidate) => candidate.creatorId === work.creatorId && candidate.id !== work.id)
        .slice(0, 30)
        .map((candidate) => calculateEngagement(candidate.metrics))
      const evaluation = evaluateHighlight(work.metrics, baseline, score)
      if (!evaluation.isHighlight) return []
      const creator = creators.find((candidate) => candidate.id === work.creatorId)
      return [{
        id: work.id,
        creatorName: creator?.name ?? '未知博主',
        title: work.title,
        publishedAt: work.publishedAt,
        likes: work.metrics.likes,
        relativeViralIndex: evaluation.relativeViralIndex,
        referenceValueScore: score,
        reasons: evaluation.reasons,
        summary: analysis ? String(analysis.result.referenceValueReason ?? '已完成内容拆解') : '达到表现阈值，等待 AI 拆解',
        originalUrl: work.originalUrl
      }]
    })
    const analyzedWorks = recentWorks.filter((work) => this.repositories.analyses.get(work.id)).length
    return {
      lastRunAt: this.lastRunAt,
      nextRunAt: nextDailyRun(new Date()).toISOString(),
      creators: creators.length,
      newWorks: recentWorks.length,
      analyzedWorks,
      run: this.runState,
      services: [
        { id: 'douyin', label: '抖音登录', status: settings.douyinLoggedIn ? 'healthy' : 'action_required', detail: settings.douyinLoggedIn ? '会话已保存' : '尚未登录', actionLabel: settings.douyinLoggedIn ? undefined : '去登录' },
        { id: 'ai', label: 'AI 拆解', status: settings.providerId ? 'healthy' : 'action_required', detail: settings.providerId ? '模型已配置' : '尚未配置', actionLabel: settings.providerId ? undefined : '去配置' },
        { id: 'feishu', label: '飞书同步', status: settings.feishuConnected ? 'healthy' : 'unavailable', detail: settings.feishuConnected ? '授权有效' : '尚未连接', actionLabel: settings.feishuConnected ? undefined : '去授权' }
      ],
      highlights
    }
  }
}
