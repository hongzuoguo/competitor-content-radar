import { randomUUID } from 'node:crypto'
import type { Work } from '../core/domain'
import { calculateEngagement, evaluateHighlight } from '../core/highlight-rules'
import { nextDailyRun } from './scheduler'
import { normalizeCreatorUrl, selectBaselineWorks, selectRecentWorks } from '../services/douyin/normalizers'
import { AppRepositories, type AnalysisRecord, type RunRecord } from '../services/database/repositories'
import type { AppDatabase } from '../services/database/database'
import type { CreatorView, DashboardData, PublicSettings, WorkDetail, WorkListItem } from '../shared/ipc-contract'
import { AnalysisSchema } from '../services/ai/analysis-schema'
import { isImportRetryable, type ImportRequest, type ImportService, type ImportStartResult } from '../services/import/import-service'

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
  resolveCreatorInput?(input: string): Promise<string>
  saveApiKey?(providerId: string, apiKey: string): Promise<void> | void
  report?(level: 'info' | 'error', message: string, detail?: unknown): void
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
  private readonly idleListeners = new Set<() => void>()
  private readonly workStateListeners = new Set<(workId: string) => void>()
  private unsubscribeImportEvents: (() => void) | null = null
  private firstCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private shuttingDown = false
  private lastRunAt: string | null = null
  private runState: DashboardData['run'] = {
    status: 'idle',
    message: '等待下一次自动运行',
    requiresAction: false,
    stages: EMPTY_STAGES
  }

  constructor(
    private readonly database: AppDatabase,
    private readonly ports: RuntimePorts,
    private readonly imports?: ImportService
  ) {
    this.repositories = new AppRepositories(database.connection)
    this.lastRunAt = this.repositories.runs.latestFinished()?.finishedAt ?? null
  }

  startImport(request: ImportRequest): Promise<ImportStartResult> {
    if (!this.imports) throw new Error('IMPORT_SERVICE_UNAVAILABLE')
    return this.imports.start(request)
  }

  retryImport(workId: string): Promise<ImportStartResult> {
    if (!this.imports) throw new Error('IMPORT_SERVICE_UNAVAILABLE')
    return this.imports.retry(workId)
  }

  deleteFailedWork(workId: string): Promise<void> {
    if (!this.imports) return Promise.reject(new Error('IMPORT_SERVICE_UNAVAILABLE'))
    return this.imports.deleteFailed(workId)
  }

  onWorkStateChanged(listener: (workId: string) => void): () => void {
    this.workStateListeners.add(listener)
    if (!this.unsubscribeImportEvents && this.imports) {
      this.unsubscribeImportEvents = this.imports.subscribe((workId) => this.emitWorkStateChanged(workId))
    }
    return () => {
      this.workStateListeners.delete(listener)
      if (this.workStateListeners.size === 0) {
        this.unsubscribeImportEvents?.()
        this.unsubscribeImportEvents = null
      }
    }
  }

  private emitWorkStateChanged(workId: string): void {
    for (const listener of this.workStateListeners) {
      try {
        listener(workId)
      } catch (error) {
        this.ports.report?.('error', '浣滃搧鐘舵€佺洃鍚櫒澶辫触', { workId, error })
      }
    }
  }

  async listWorks(): Promise<WorkListItem[]> {
    const creators = this.repositories.creators.list()
    const allWorks = this.repositories.works.listAll()
    const creatorNames = new Map(creators.map((creator) => [creator.id, creator.name]))
    const jobs = new Map(this.repositories.jobs.list().map((job) => [job.workId, job]))
    const analyses = new Map(this.repositories.analyses.list().map((analysis) => [analysis.workId, analysis]))
    const artifacts = new Map(this.repositories.artifacts.list().map((artifact) => [artifact.workId, artifact]))
    const worksByCreator = new Map<string | null, Work[]>()
    for (const work of allWorks) {
      const group = worksByCreator.get(work.creatorId) ?? []
      group.push(work)
      worksByCreator.set(work.creatorId, group)
    }
    const baselines = new Map<string, number[]>()
    for (const works of worksByCreator.values()) {
      const engagement = works.map((work) => calculateEngagement(work.metrics))
      for (let index = 0; index < works.length; index += 1) {
        baselines.set(works[index].id, index < 30
          ? [...engagement.slice(0, index), ...engagement.slice(index + 1, 31)]
          : engagement.slice(0, 30))
      }
    }
    return allWorks.map((work) => {
      const job = jobs.get(work.id) ?? null
      const analysis = analyses.get(work.id)
      const artifact = artifacts.get(work.id)
      const scoreValue = analysis?.result.referenceValueScore
      const referenceValueScore = typeof scoreValue === 'number' ? scoreValue : null
      const evaluation = evaluateHighlight(work.metrics, baselines.get(work.id) ?? [], referenceValueScore)
      return {
        id: work.id,
        creatorId: work.creatorId,
        creatorName: (work.creatorId ? creatorNames.get(work.creatorId) : undefined) ?? '未分类作品',
        title: work.title,
        sourceType: work.sourceType,
        publishedAt: work.publishedAt,
        status: job?.status ?? 'completed',
        stage: job?.stage ?? 'completed',
        errorCode: job?.errorCode ?? null,
        errorMessage: job?.errorMessage ?? null,
        retryable: isImportRetryable(job, work),
        ...(artifact?.existingWorkId ? { existingWorkId: artifact.existingWorkId } : {}),
        likes: work.metrics.likes,
        relativeViralIndex: evaluation.relativeViralIndex,
        referenceValueScore,
        reasons: evaluation.reasons
      }
    })
  }

  async getWork(id: string): Promise<WorkDetail | null> {
    const work = this.repositories.works.get(id)
    if (!work) return null
    const listItem = (await this.listWorks()).find((candidate) => candidate.id === id)
    if (!listItem) return null
    const artifact = this.repositories.artifacts.get(id)
    const analysis = this.repositories.analyses.get(id)
    const parsedAnalysis = analysis ? AnalysisSchema.safeParse(analysis.result) : null
    return {
      ...listItem,
      originalUrl: work.originalUrl,
      comments: work.metrics.comments,
      shares: work.metrics.shares,
      collects: work.metrics.collects,
      transcript: analysis?.transcript ?? artifact?.transcript ?? null,
      analysis: parsedAnalysis?.success ? parsedAnalysis.data : null,
      analysisProvider: analysis?.provider ?? null,
      analyzedAt: analysis?.createdAt ?? null
    }
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
    const resolvedInput = this.ports.resolveCreatorInput
      ? await this.ports.resolveCreatorInput(input)
      : input
    const profileUrl = normalizeCreatorUrl(resolvedInput)
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
    this.scheduleFirstCapture(creator.id)
    return { ...creator, works: 0, lastRun: '尚未采集', status: 'waiting' }
  }

  private scheduleFirstCapture(creatorId: string): void {
    if (this.shuttingDown) return
    if (this.firstCaptureTimer) clearTimeout(this.firstCaptureTimer)
    const timer = setTimeout(() => {
      if (this.firstCaptureTimer !== timer) return
      this.firstCaptureTimer = null
      if (this.shuttingDown || !this.database.connection.open) return
      void this.runNow('manual').then((result) => {
        if (!result.accepted) {
          this.bestEffortReport('info', 'First capture deferred', {
            code: 'FIRST_CAPTURE_DEFERRED', creatorId
          })
        }
      }).catch(() => {
        this.bestEffortReport('error', 'First capture start failed', {
          code: 'FIRST_CAPTURE_START_FAILED', creatorId
        })
      })
    }, 0)
    this.firstCaptureTimer = timer
  }

  private bestEffortReport(
    level: 'info' | 'error',
    message: string,
    detail: { code: string; creatorId: string }
  ): void {
    try {
      this.ports.report?.(level, message, detail)
    } catch {
      // Reporting must never escape a fire-and-forget task.
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    if (this.firstCaptureTimer) {
      clearTimeout(this.firstCaptureTimer)
      this.firstCaptureTimer = null
    }
  }

  async toggleCreator(id: string, enabled: boolean): Promise<void> {
    this.repositories.creators.setEnabled(id, enabled)
  }

  async deleteCreator(id: string): Promise<void> {
    this.repositories.creators.delete(id)
  }

  async getSettings(): Promise<PublicSettings> {
    return this.repositories.settings.get<PublicSettings>('app.publicSettings') ?? {
      dailyTime: '08:00', weeklyTime: '09:30', absoluteLikes: 10_000,
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

  async runNow(kind: RunRecord['kind'] = 'manual'): Promise<{ accepted: boolean; reason?: string }> {
    if (this.firstCaptureTimer) {
      clearTimeout(this.firstCaptureTimer)
      this.firstCaptureTimer = null
    }
    if (this.shuttingDown) return { accepted: false, reason: '应用正在退出' }
    if (this.running) return { accepted: false, reason: '已有任务正在运行' }
    const settings = await this.getSettings()
    const creators = this.repositories.creators.list().filter((creator) => creator.enabled)
    if (creators.length === 0) return { accepted: false, reason: '请先添加至少一位博主' }
    this.running = true
    this.runState = {
      status: 'running', message: '正在采集公开作品，暂时无需操作', requiresAction: false,
      stages: EMPTY_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'running' as const : 'pending' as const }))
    }
    void this.executeRun(creators, settings, kind)
    return { accepted: true }
  }

  private async executeRun(
    creators: ReturnType<AppRepositories['creators']['list']>,
    settings: PublicSettings,
    kind: RunRecord['kind']
  ): Promise<void> {
    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    let discoveredCount = 0
    let analyzedCount = 0
    let partial = false
    let waitingForModel = false
    let discoveryFailed = false
    let analysisFailed = false
    try {
      this.repositories.runs.save({
        id: runId, kind, status: 'running', startedAt, finishedAt: null, summary: null
      })
      for (const creator of creators) {
        this.ports.report?.('info', '开始采集博主', { creatorId: creator.id, profileUrl: creator.profileUrl })
        let discovered: Work[]
        try {
          discovered = selectBaselineWorks(await this.ports.discover(creator.id, creator.profileUrl))
        } catch (error) {
          partial = true
          discoveryFailed = true
          this.ports.report?.('error', '博主采集失败', { creatorId: creator.id, error })
          continue
        }
        this.ports.report?.('info', '博主采集完成', { creatorId: creator.id, works: discovered.length })
        for (const work of discovered) {
          this.repositories.transaction(() => {
            this.repositories.works.upsert(work)
            this.repositories.snapshots.create({
              id: randomUUID(), workId: work.id, capturedAt: new Date().toISOString(), metrics: work.metrics
            })
          })
          this.emitWorkStateChanged(work.id)
          discoveredCount += 1
        }
        if (settings.providerId && settings.modelId) {
          for (const work of selectRecentWorks(discovered)) {
            if (this.repositories.analyses.get(work.id)) continue
            try {
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
              this.emitWorkStateChanged(work.id)
              analyzedCount += 1
            } catch (error) {
              partial = true
              analysisFailed = true
              this.ports.report?.('error', '作品处理失败', { workId: work.id, error })
              continue
            }
          }
        } else {
          partial = true
          waitingForModel = true
        }
      }
      const finishedAt = new Date().toISOString()
      this.lastRunAt = finishedAt
      const status = partial ? 'partial' as const : 'completed' as const
      this.repositories.runs.save({
        id: runId, kind, status, startedAt, finishedAt,
        summary: { discovered: discoveredCount, analyzed: analyzedCount, waitingForModel }
      })
      const feishuConnected = settings.feishuConnected === true
      this.runState = {
        status,
        message: waitingForModel
          ? discoveryFailed
            ? '本次运行部分完成；部分博主采集失败，同时等待模型配置'
            : '已完成作品采集，等待模型配置后进行转写和 AI 拆解'
          : partial ? '本次运行部分完成，请查看失败项后重试'
            : feishuConnected ? '本次采集、转写、分析和同步已完成' : '本地采集、转写和分析已完成；飞书尚未连接',
        requiresAction: partial,
        stages: EMPTY_STAGES.map((stage) => ({
          ...stage,
          status: (waitingForModel && (stage.id === 'download' || stage.id === 'transcription' || stage.id === 'analysis')) ||
            (discoveryFailed && stage.id === 'discovery') ||
            (analysisFailed && stage.id === 'analysis') ||
            (stage.id === 'feishu' && !feishuConnected)
            ? 'pending' as const
            : 'completed' as const
        }))
      }
    } catch (error) {
      this.ports.report?.('error', '运行失败', error)
      const finishedAt = new Date().toISOString()
      try {
        this.repositories.runs.save({
          id: runId, kind, status: 'failed', startedAt, finishedAt,
          summary: { error: 'RUN_FAILED', discovered: discoveredCount, analyzed: analyzedCount }
        })
      } catch (persistenceError) {
        this.ports.report?.('error', '运行状态保存失败', persistenceError)
      }
      this.runState = {
        status: 'failed', message: error instanceof Error ? error.message : '任务失败', requiresAction: true,
        stages: this.runState.stages
      }
    } finally {
      this.running = false
      for (const listener of this.idleListeners) listener()
    }
  }

  latestCompletedDailyRunAt(): Date | null {
    const finishedAt = this.repositories.runs.latestCompletedDaily()?.finishedAt
    return finishedAt ? new Date(finishedAt) : null
  }

  isBusinessIdle(): boolean {
    return !this.running
  }

  onBusinessIdle(listener: () => void): () => void {
    this.idleListeners.add(listener)
    return () => this.idleListeners.delete(listener)
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
        originalUrl: work.originalUrl ?? ''
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
