import { randomUUID } from 'node:crypto'
import type { Work, WorkOwnership } from '../core/domain'
import type { WorkflowStage } from '../core/workflow'
import { calculateEngagement, evaluateHighlight } from '../core/highlight-rules'
import { evaluateRadarStatus, type RadarEvaluation } from '../core/radar-status'
import { normalizeCreatorUrl, selectAnalysisCandidates, selectBaselineWorks } from '../services/douyin/normalizers'
import type { CreatorDiscoveryResult } from '../services/douyin/discovery'
import { AppRepositories, type AnalysisRecord, type MetricSnapshotRecord, type RunRecord } from '../services/database/repositories'
import type { AppDatabase } from '../services/database/database'
import { isFeishuSyncMode, type AgentReasoningEffort, type CreatorView, type DashboardData, type FeishuConnectionView, type FeishuCustomAppConnectionInput, type ManualAnalysisResult, type PublicSettings, type RunFailure, type RunHistoryItem, type RunStartResult, type SettingsInput, type TargetedCreatorRetryRequest, type WorkDetail, type WorkListItem } from '../shared/ipc-contract'
import { chinaDateKey } from '../core/local-date'
import { AnalysisSchema, type AnalysisResult } from '../services/ai/analysis-schema'
import type { WeeklyTopicClusterResult, WeeklyTopicWork } from '../services/ai/weekly-topic-clustering'
import { isImportRetryable, type ImportRequest, type ImportService, type ImportStartResult } from '../services/import/import-service'
import type { ModelProfileService } from '../services/ai/model-profile-service'
import { hasAnalysisSyncChange, hasSnapshotSyncChange, hasWorkSyncChange } from '../services/feishu/local-change'
import { FeishuSyncCoordinator } from '../services/feishu/sync-coordinator'
import { RECOMMENDED_BEHAVIOR_SETTINGS, RECOMMENDED_CLEAR_KEYS } from '../shared/default-settings'
import { normalizeRuntimeError, safeFailureReport, safeOperationalReport, type NormalizedRuntimeError } from '../shared/run-failure-report'
import { safeWorkFailure } from '../shared/work-failure-display'

export interface ProcessedWork {
  transcript: string
  result: Record<string, unknown>
  provider: string
  model: string
  promptVersion: string
  tokenUsage: Record<string, number> | null
}

export type DiscoveredWork = Work & { transcript?: string }

export interface WorkProcessProgress {
  stage: WorkflowStage
  label: string
}

export interface ActiveModelIdentity {
  profileId: string
  providerId: string
  modelId: string
}

export interface RuntimePorts {
  discover(creatorId: string, profileUrl: string, ownership?: WorkOwnership): Promise<DiscoveredWork[] | CreatorDiscoveryResult<DiscoveredWork>>
  processWork(work: Work, settings: PublicSettings, onProgress?: (progress: WorkProcessProgress) => void): Promise<ProcessedWork>
  login(): Promise<void>
  logout?(): Promise<void>
  isLoggedIn?(): Promise<boolean>
  closeBrowser?(): Promise<void>
  profileDirectory?: string
  resolveCreatorInput?(input: string): Promise<string>
  saveApiKey?(providerId: string, apiKey: string): Promise<void> | void
  getApiKeyConfiguredByProvider?(): Record<string, boolean>
  isModelConfigured?(): boolean
  getActiveModelIdentity?(): ActiveModelIdentity | null
  clusterWeeklyTopics?(works: WeeklyTopicWork[], settings: PublicSettings): Promise<WeeklyTopicClusterResult>
  report?(level: 'info' | 'error', message: string, detail?: unknown): void
  removeManagedMedia?(workIds: string[]): Promise<void>
  agentAccess?: {
    resetToken(): string
  }
  /** Detects an installed Codex CLI for headless local analysis. */
  detectAgentCli?(settings?: PublicSettings): Promise<import('../services/agent/agent-cli-detector').DetectedAgentCli | null>
  /** Runs one analysis through the local Codex CLI and writes it back. */
  runAgentAnalysis?(work: Work, settings: PublicSettings): Promise<void>
  /** Runs the one-click rewrite through the local Codex CLI (JSON out). */
  agentRewrite?(workId: string, payload: import('../shared/ipc-contract').RewriteRequestView, settings: PublicSettings): Promise<import('../shared/ipc-contract').RewriteResultView>
  /** Best-effort notification after a committed Codex model/reasoning change. */
  onCodexSettingsChanged?(): void
  /** Rewrites a competitor's article through the cloud model using Humanizer-zh rules. */
  rewriteWork?(workId: string, payload: import('../shared/ipc-contract').RewriteRequestView): Promise<import('../shared/ipc-contract').RewriteResultView>
  feishu?: {
    getConnection(): FeishuConnectionView
    connectCustomApp(input: FeishuCustomAppConnectionInput): Promise<FeishuConnectionView>
    repair(selectedAppToken?: string): Promise<FeishuConnectionView>
    recreate(): Promise<FeishuConnectionView>
    disconnect(): Promise<FeishuConnectionView>
    syncAll(): Promise<FeishuConnectionView>
    waitForActiveDataSync?(): Promise<void>
    syncWork(workId: string, refreshSemanticSummaries?: boolean): Promise<void>
    openBase?(): Promise<void>
    openDeveloperConsole?(): Promise<void>
  }
}

const EMPTY_STAGES = [
  { id: 'discovery', label: '采集', status: 'pending' as const },
  { id: 'download', label: '下载', status: 'pending' as const },
  { id: 'transcription', label: '转写', status: 'pending' as const },
  { id: 'analysis', label: 'AI 拆解', status: 'pending' as const },
  { id: 'feishu', label: '飞书同步', status: 'pending' as const }
]

type RunSlotOwner = 'normal' | 'targeted' | 'first-capture' | 'feishu'

interface RunReservation {
  token: symbol
  owner: RunSlotOwner
  pausedArmedByReservation: boolean
}

interface RunExecutionTrace {
  retryOfRunId: string
  targetCreatorIds: string[]
}

const PUBLIC_SETTINGS_SCHEMA_VERSION = 2
const RELATIVE_PERFORMANCE_SETTINGS_SCHEMA_VERSION = 1
const SEPARATE_AGENT_REASONING_SETTINGS_SCHEMA_VERSION = 2
const EMBEDDED_AGENT_REASONING_PATTERN = /^(.*)-(low|medium|high|xhigh|max)$/

function normalizeAgentModel(
  model: string | undefined,
  reasoningEffort: AgentReasoningEffort | undefined
): { agentModel?: string; agentReasoningEffort?: AgentReasoningEffort } {
  if (model === undefined) return { agentReasoningEffort: reasoningEffort }
  const match = model.trim().match(EMBEDDED_AGENT_REASONING_PATTERN)
  if (!match) return { agentModel: model, agentReasoningEffort: reasoningEffort }
  return {
    agentModel: match[1],
    agentReasoningEffort: reasoningEffort ?? match[2] as AgentReasoningEffort
  }
}

export class DesktopRuntime {
  private readonly repositories: AppRepositories
  private readonly feishuSyncCoordinator: FeishuSyncCoordinator
  private running = false
  private readonly idleListeners = new Set<() => void>()
  private readonly workStateListeners = new Set<(workId: string) => void>()
  private readonly manuallyProcessingWorkIds = new Set<string>()
  private readonly workProgressLabels = new Map<string, string>()
  private unsubscribeImportEvents: (() => void) | null = null
  private firstCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private readonly firstCaptureCreatorIds = new Set<string>()
  private firstCaptureParked = false
  private firstCaptureDeferredWake = false
  private activeReservation: RunReservation | null = null
  private shuttingDown = false
  private lastRunAt: string | null = null
  private runState: DashboardData['run'] = {
    runId: null,
    status: 'idle',
    message: '等待手动运行或添加博主后的首次采集',
    requiresAction: false,
    stages: EMPTY_STAGES
  }
  private weeklyTopicClustering: { key: string; promise: Promise<WeeklyTopicClusterResult> } | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly ports: RuntimePorts,
    private readonly imports?: ImportService,
    readonly modelProfiles?: ModelProfileService
  ) {
    this.repositories = new AppRepositories(database.connection)
    const legacySettings = this.repositories.settings.get<PublicSettings>('app.publicSettings')
    const legacyFeishuSyncMode = isFeishuSyncMode(legacySettings?.feishuSyncMode)
      ? legacySettings.feishuSyncMode
      : undefined
    this.feishuSyncCoordinator = new FeishuSyncCoordinator(
      this.repositories.settings,
      () => this.syncFeishuPort(),
      undefined,
      legacyFeishuSyncMode
    )
    if (legacySettings && Object.hasOwn(legacySettings, 'feishuSyncMode')) {
      const { feishuSyncMode: _legacyFeishuSyncMode, ...migratedSettings } = legacySettings
      this.repositories.settings.set('app.publicSettings', migratedSettings)
    }
    this.reconcileInterruptedRuns()
    this.lastRunAt = this.repositories.runs.latestFinished()?.finishedAt ?? null
  }

  private reconcileInterruptedRuns(): void {
    const finishedAt = new Date().toISOString()
    for (const run of this.repositories.runs.listRunning()) {
      const previousSummary = run.summary ?? {}
      this.repositories.runs.save({
        ...run,
        status: 'failed',
        finishedAt,
        summary: {
          ...previousSummary,
          error: 'APP_INTERRUPTED',
          interrupted: true,
          message: '应用在任务完成前退出，任务已停止；请重新手动运行。'
        }
      })
    }
  }

  startImport(request: ImportRequest): Promise<ImportStartResult> {
    if (!this.imports) throw new Error('IMPORT_SERVICE_UNAVAILABLE')
    return this.imports.start(request)
  }

  retryImport(workId: string): Promise<ImportStartResult> {
    if (!this.imports) throw new Error('IMPORT_SERVICE_UNAVAILABLE')
    return this.imports.retry(workId)
  }

  async deleteFailedWork(workId: string): Promise<void> {
    if (!this.imports) return Promise.reject(new Error('IMPORT_SERVICE_UNAVAILABLE'))
    await this.imports.deleteFailed(workId)
    await this.flushFeishuAfterTask()
  }

  markFeishuLocalChange(): void {
    this.feishuSyncCoordinator.markLocalChange()
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
      } catch {
        this.ports.report?.('error', '浣滃搧鐘舵€佺洃鍚櫒澶辫触', safeOperationalReport('WORK_STATE_LISTENER_FAILED', { workId }))
      }
    }
  }

  async listWorks(): Promise<WorkListItem[]> {
    const settings = await this.getSettings()
    const creators = this.repositories.creators.list()
    const allWorks = this.repositories.works.listAll()
    const creatorNames = new Map(creators.map((creator) => [creator.id, creator.name]))
    const jobs = new Map(this.repositories.jobs.list().map((job) => [job.workId, job]))
    const analyses = new Map(this.repositories.analyses.list().map((analysis) => [analysis.workId, analysis]))
    const artifacts = new Map(this.repositories.artifacts.list().map((artifact) => [artifact.workId, artifact]))
    const snapshotsByWork = this.repositories.snapshots.listAllByWork()
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
      const artifact = artifacts.get(work.id)
      const baseline = baselines.get(work.id) ?? []
      const evaluation = evaluateHighlight(work.metrics, baseline, highlightThresholds(settings))
      const radar = isPublishedWithinDays(work, settings.analysisRecentDays ?? 30)
        ? evaluateRadarStatus(work.metrics, snapshotsByWork.get(work.id) ?? [], baseline, highlightThresholds(settings))
        : null
      return {
        id: work.id,
        creatorId: work.creatorId,
        creatorName: (work.creatorId ? creatorNames.get(work.creatorId) : undefined) ?? '未分类作品',
        title: work.title,
        sourceType: work.sourceType,
        ownership: work.ownership,
        publishedAt: work.publishedAt,
        status: job?.status ?? 'completed',
        stage: job?.stage ?? 'completed',
        progressLabel: this.workProgressLabels.get(work.id) ?? null,
        errorCode: job?.errorCode ?? null,
        errorMessage: job?.errorMessage ?? null,
        retryable: isImportRetryable(job, work),
        ...(artifact?.existingWorkId ? { existingWorkId: artifact.existingWorkId } : {}),
        likes: work.metrics.likes,
        relativePerformanceMultiplier: evaluation.relativePerformanceMultiplier,
        reasons: evaluation.reasons,
        radarStatus: radar?.status ?? null,
        radarEvidence: radar?.evidence ?? [],
        firstBecameViralAt: radar?.firstBecameViralAt ?? null,
        canAnalyzeManually: !analyses.has(work.id) && job?.status !== 'running' && !this.manuallyProcessingWorkIds.has(work.id)
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
    let analysisResult: AnalysisResult | null = null
    if (analysis) {
      const parsedAnalysis = AnalysisSchema.safeParse(analysis.result)
      if (parsedAnalysis.success) {
        analysisResult = parsedAnalysis.data
      } else {
        // 老数据可能缺字段，补全后再返回，保证前端结构完整
        const raw = analysis.result && typeof analysis.result === 'object' ? analysis.result as Record<string, unknown> : {}
        analysisResult = {
          topicCategory: typeof raw.topicCategory === 'string' ? raw.topicCategory : undefined,
          contentKeywords: Array.isArray(raw.contentKeywords) ? raw.contentKeywords.filter((value): value is string => typeof value === 'string') : [],
          topicAngle: typeof raw.topicAngle === 'string' ? raw.topicAngle : '',
          openingHook: raw.openingHook && typeof raw.openingHook === 'object'
            ? { quote: typeof (raw.openingHook as Record<string, unknown>).quote === 'string' ? (raw.openingHook as Record<string, unknown>).quote as string : '', type: typeof (raw.openingHook as Record<string, unknown>).type === 'string' ? (raw.openingHook as Record<string, unknown>).type as string : '', mechanism: typeof (raw.openingHook as Record<string, unknown>).mechanism === 'string' ? (raw.openingHook as Record<string, unknown>).mechanism as string : '' }
            : { quote: '', type: '', mechanism: '' },
          structure: Array.isArray(raw.structure) ? raw.structure as string[] : [],
          viralPoints: Array.isArray(raw.viralPoints) ? raw.viralPoints as string[] : [],
          highlights: Array.isArray(raw.highlights) ? raw.highlights as string[] : [],
          reusablePatterns: Array.isArray(raw.reusablePatterns) ? raw.reusablePatterns as string[] : [],
          differentiatedSuggestions: raw.differentiatedSuggestions && typeof raw.differentiatedSuggestions === 'object'
            ? {
                angles: Array.isArray((raw.differentiatedSuggestions as Record<string, unknown>).angles) ? (raw.differentiatedSuggestions as Record<string, unknown>).angles as string[] : [],
                titles: Array.isArray((raw.differentiatedSuggestions as Record<string, unknown>).titles) ? (raw.differentiatedSuggestions as Record<string, unknown>).titles as string[] : [],
                openings: Array.isArray((raw.differentiatedSuggestions as Record<string, unknown>).openings) ? (raw.differentiatedSuggestions as Record<string, unknown>).openings as string[] : [],
                risks: Array.isArray((raw.differentiatedSuggestions as Record<string, unknown>).risks) ? (raw.differentiatedSuggestions as Record<string, unknown>).risks as string[] : []
              }
            : { angles: [], titles: [], openings: [], risks: [] }
        }
      }
    }
    return {
      ...listItem,
      originalUrl: work.originalUrl,
      comments: work.metrics.comments,
      shares: work.metrics.shares,
      collects: work.metrics.collects,
      transcript: analysis?.transcript ?? artifact?.transcript ?? null,
      analysis: analysisResult,
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
      status: this.lastRunAt ? 'ready' : 'waiting',
      ownership: creator.ownership ?? 'competitor'
    }))
  }

  async addCreator(input: string | { url: string; ownership: 'mine' }): Promise<CreatorView> {
    const ownership: WorkOwnership = typeof input === 'object' && input.ownership === 'mine' ? 'mine' : 'competitor'
    const urlInput = typeof input === 'object' ? input.url : input
    const resolvedInput = this.ports.resolveCreatorInput
      ? await this.ports.resolveCreatorInput(urlInput)
      : urlInput
    const profileUrl = normalizeCreatorUrl(resolvedInput)
    const creators = this.repositories.creators.list()
    const existing = creators.find((creator) => creator.profileUrl === profileUrl)
    if (existing) {
      const upgraded = ownership === 'mine' && existing.ownership !== 'mine'
        ? { ...existing, ownership: 'mine' as const }
        : existing
      if (upgraded !== existing) {
        this.repositories.transaction(() => {
          this.repositories.creators.setOwnership(existing.id, 'mine')
          this.feishuSyncCoordinator.markLocalChange()
        })
        this.scheduleFirstCapture(existing.id)
      }
      return {
        ...upgraded,
        works: this.repositories.works.listByCreator(existing.id).length,
        lastRun: this.lastRunAt ? new Date(this.lastRunAt).toLocaleString('zh-CN', { hour12: false }) : '尚未采集',
        status: this.lastRunAt ? 'ready' : 'waiting'
      }
    }
    if (creators.length >= 10) throw new Error('CREATOR_LIMIT_REACHED')
    const handle = profileUrl.split('/').at(-1) ?? '新博主'
    const creator = {
      id: randomUUID(),
      platform: 'douyin' as const,
      name: ownership === 'mine' ? '我的账号' : `@${handle.slice(0, 18)}`,
      profileUrl,
      enabled: true,
      createdAt: new Date().toISOString(),
      ownership
    }
    const savedCreator = this.repositories.transaction(() => {
      const saved = this.repositories.creators.create(creator)
      this.feishuSyncCoordinator.markLocalChange()
      return saved
    })
    this.scheduleFirstCapture(savedCreator.id)
    return { ...savedCreator, works: 0, lastRun: '尚未采集', status: 'waiting' }
  }

  private scheduleFirstCapture(creatorId: string): void {
    if (this.shuttingDown) return
    this.firstCaptureCreatorIds.add(creatorId)
    if (this.running) {
      this.firstCaptureDeferredWake = true
      return
    }
    this.firstCaptureParked = false
    this.armFirstCapture()
  }

  private armFirstCapture(): void {
    if (this.shuttingDown || this.running || this.firstCaptureParked || this.firstCaptureTimer || this.firstCaptureCreatorIds.size === 0) return
    const timer = setTimeout(() => {
      if (this.firstCaptureTimer !== timer) return
      this.firstCaptureTimer = null
      const creatorIds = [...this.firstCaptureCreatorIds]
      if (this.shuttingDown || !this.database.connection.open) return
      if (this.running) {
        this.firstCaptureDeferredWake = true
        return
      }
      void this.runCreators('manual', creatorIds, { owner: 'first-capture' }).then((result) => {
        if (!result.accepted) {
          for (const creatorId of creatorIds) {
            this.bestEffortReport('info', 'First capture deferred', {
              code: 'FIRST_CAPTURE_DEFERRED', creatorId,
              ...(result.reason === undefined ? {} : { reason: result.reason })
            })
          }
        }
      }).catch(() => {
        for (const creatorId of creatorIds) {
          this.bestEffortReport('error', 'First capture start failed', {
            code: 'FIRST_CAPTURE_START_FAILED', creatorId
          })
        }
      })
    }, 0)
    this.firstCaptureTimer = timer
  }

  private bestEffortReport(
    level: 'info' | 'error',
    message: string,
    detail: { code: string; creatorId: string; reason?: string }
  ): void {
    try {
      this.ports.report?.(level, message, detail)
    } catch {
      // Reporting must never escape a fire-and-forget task.
    }
  }

  private reserveRunSlot(owner: RunSlotOwner): RunReservation | null {
    if (this.shuttingDown || this.running) return null
    const pausedArmedByReservation = this.firstCaptureTimer !== null
    if (this.firstCaptureTimer) {
      clearTimeout(this.firstCaptureTimer)
      this.firstCaptureTimer = null
    }
    const reservation = { token: Symbol(owner), owner, pausedArmedByReservation }
    this.running = true
    this.activeReservation = reservation
    return reservation
  }

  private releaseRunSlot(
    reservation: RunReservation,
    policy: 'restore-paused' | 'wake' | 'park' | 'none'
  ): void {
    if (this.activeReservation?.token !== reservation.token) return
    this.activeReservation = null
    this.running = false
    if (this.shuttingDown) {
      reservation.pausedArmedByReservation = false
      this.notifyIfBusinessIdle()
      return
    }
    if (policy === 'park') {
      this.firstCaptureParked = this.firstCaptureCreatorIds.size > 0
      this.firstCaptureDeferredWake = false
    } else if (policy === 'wake' || (policy === 'restore-paused' && (reservation.pausedArmedByReservation || this.firstCaptureDeferredWake))) {
      this.firstCaptureParked = false
      this.firstCaptureDeferredWake = false
      this.armFirstCapture()
    } else if (policy === 'restore-paused' && this.firstCaptureCreatorIds.size > 0) {
      this.firstCaptureParked = true
      this.firstCaptureDeferredWake = false
    }
    this.notifyIfBusinessIdle()
  }

  private notifyIfBusinessIdle(): void {
    if (!this.isBusinessIdle()) return
    for (const listener of this.idleListeners) listener()
  }

  shutdown(): void {
    this.shuttingDown = true
    this.firstCaptureCreatorIds.clear()
    this.firstCaptureParked = false
    this.firstCaptureDeferredWake = false
    if (this.activeReservation) this.activeReservation.pausedArmedByReservation = false
    if (this.firstCaptureTimer) {
      clearTimeout(this.firstCaptureTimer)
      this.firstCaptureTimer = null
    }
    this.notifyIfBusinessIdle()
  }

  async toggleCreator(id: string, enabled: boolean): Promise<void> {
    this.repositories.transaction(() => {
      const creator = this.repositories.creators.getById(id)
      this.repositories.creators.setEnabled(id, enabled)
      if (creator && creator.enabled !== enabled) this.feishuSyncCoordinator.markLocalChange()
    })
    await this.flushFeishuAfterTask()
  }

  async deleteCreator(id: string): Promise<void> {
    const workIds = this.repositories.works.listByCreator(id).map((work) => work.id)
    this.repositories.transaction(() => {
      const creator = this.repositories.creators.getById(id)
      this.repositories.creators.delete(id)
      if (creator || workIds.length > 0) this.feishuSyncCoordinator.markLocalChange()
    })
    await this.ports.removeManagedMedia?.(workIds)
    await this.flushFeishuAfterTask()
  }

  async clearUnclassifiedWorks(): Promise<void> {
    const workIds = this.repositories.transaction(() => {
      const ids = this.repositories.works.deleteUnclassified()
      if (ids.length > 0) this.feishuSyncCoordinator.markLocalChange()
      return ids
    })
    await this.ports.removeManagedMedia?.(workIds)
    await this.flushFeishuAfterTask()
  }

  async listRuns(): Promise<RunHistoryItem[]> {
    return this.repositories.runs.list().map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      discovered: numberFromSummary(run.summary, 'discovered'),
      selectedForAnalysis: numberFromSummary(run.summary, 'selectedForAnalysis'),
      analyzed: numberFromSummary(run.summary, 'analyzed'),
      failures: failuresFromSummary(run.summary)
    }))
  }

  async retryRun(id: string): Promise<{ accepted: boolean; reason?: string }> {
    const run = this.repositories.runs.get(id)
    if (!run) return { accepted: false, reason: '任务记录不存在' }
    const failures = failuresFromSummary(run.summary)
    if (failures.length > 0 && failures.every((failure) => failure.stage === 'feishu')) {
      if (!this.ports.feishu) return { accepted: false, reason: '请先连接飞书' }
      const reservation = this.reserveRunSlot('feishu')
      if (!reservation) return { accepted: false, reason: this.shuttingDown ? '应用正在退出' : '已有任务正在运行' }
      this.runState = {
        runId: run.id,
        status: 'running',
        message: '正在重新同步本地数据，不会重新采集或调用 AI',
        requiresAction: false,
        stages: EMPTY_STAGES.map((stage) => ({
          ...stage,
          status: stage.id === 'feishu' ? 'running' as const : 'completed' as const
        }))
      }
      void this.retryFeishuSync(run, reservation)
      return { accepted: true }
    }
    return this.runNow('manual')
  }

  private async retryFeishuSync(run: RunRecord, reservation: RunReservation): Promise<void> {
    try {
      await this.feishuSyncCoordinator.syncNow()
      for (const job of this.repositories.jobs.list()) {
        if (job.errorCode !== 'FEISHU_SYNC_FAILED') continue
        this.repositories.jobs.save({
          ...job,
          stage: 'completed',
          status: 'completed',
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date().toISOString()
        })
        this.emitWorkStateChanged(job.workId)
      }
      const summary = { ...(run.summary ?? {}), failures: [] }
      this.repositories.runs.save({
        ...run,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        summary
      })
      this.runState = {
        runId: run.id,
        status: 'completed',
        message: '本地数据已成功同步到飞书',
        requiresAction: false,
        failures: [],
        stages: EMPTY_STAGES.map((stage) => ({ ...stage, status: 'completed' as const }))
      }
    } catch {
      this.ports.report?.('error', '飞书重试同步失败', this.feishuSyncFailureDetail())
      this.runState = {
        runId: run.id,
        status: 'partial',
        message: '本地数据仍然安全，飞书同步尚未完成',
        requiresAction: true,
        failures: failuresFromSummary(run.summary),
        stages: EMPTY_STAGES.map((stage) => ({
          ...stage,
          status: stage.id === 'feishu' ? 'failed' as const : 'completed' as const
        }))
      }
    } finally {
      this.releaseRunSlot(reservation, 'restore-paused')
    }
  }

  async deleteRun(id: string): Promise<void> {
    const run = this.repositories.runs.get(id)
    if (!run) throw new Error('RUN_NOT_FOUND')
    if (run.status === 'running') throw new Error('RUN_DELETE_NOT_ALLOWED')
    if (!this.repositories.runs.delete(id)) throw new Error('RUN_DELETE_FAILED')
  }

  /** Regenerate the local Agent access token. The old token stops working immediately. */
  async resetAgentAccessToken(): Promise<string> {
    if (!this.ports.agentAccess) throw new Error('AGENT_ACCESS_SERVICE_UNAVAILABLE')
    return this.ports.agentAccess.resetToken()
  }

  /** Read the stored analysis record for one work, or null when absent. */
  getStoredAnalysis(workId: string): AnalysisRecord | null {
    return this.repositories.analyses.get(workId)
  }

  /** Persist an analysis record produced by the local Agent path. */
  saveAgentAnalysis(record: AnalysisRecord): void {
    this.repositories.transaction(() => {
      const previous = this.repositories.analyses.get(record.workId) ?? undefined
      this.repositories.analyses.save(record)
      if (hasAnalysisSyncChange(previous, record)) this.feishuSyncCoordinator.markLocalChange()
      this.repositories.jobs.save({
        workId: record.workId, stage: 'analyzed', status: 'completed', attemptCount: 1,
        nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString()
      })
    })
    this.emitWorkStateChanged(record.workId)
  }

  async getSettings(): Promise<PublicSettings> {
    const saved = this.repositories.settings.get<PublicSettings>('app.publicSettings')
    const schemaVersion = this.repositories.settings.get<number>('app.publicSettingsSchemaVersion') ?? 0
    const defaults: PublicSettings = {
      dailyTime: '08:00',
      ...RECOMMENDED_BEHAVIOR_SETTINGS,
      feishuSyncMode: this.feishuSyncCoordinator.getState().mode,
      agentModel: undefined,
      agentReasoningEffort: undefined
    }
    if (saved) {
      const migrated = {
        ...defaults,
        ...saved,
        relativePerformanceMultiplier: schemaVersion < RELATIVE_PERFORMANCE_SETTINGS_SCHEMA_VERSION && saved.relativePerformanceMultiplier === 30
          ? 3
          : (saved.relativePerformanceMultiplier
            ?? (saved.relativeViralIndex !== undefined ? saved.relativeViralIndex / 100 : 3)),
        ...(schemaVersion < SEPARATE_AGENT_REASONING_SETTINGS_SCHEMA_VERSION
          ? normalizeAgentModel(saved.agentModel, saved.agentReasoningEffort)
          : {}),
        dailyTime: '08:00'
      }
      delete migrated.relativeViralIndex
      delete (migrated as PublicSettings & { weeklyTime?: string }).weeklyTime
      delete migrated.feishuSyncMode
      this.repositories.settings.set('app.publicSettings', migrated)
      if (schemaVersion < PUBLIC_SETTINGS_SCHEMA_VERSION) {
        this.repositories.settings.set('app.publicSettingsSchemaVersion', PUBLIC_SETTINGS_SCHEMA_VERSION)
      }
      return {
        ...migrated,
        feishuSyncMode: this.feishuSyncCoordinator.getState().mode,
        ...(this.ports.feishu
          ? { feishuConnected: this.ports.feishu.getConnection().status === 'connected' }
          : {}),
        apiKeyConfiguredByProvider: this.ports.getApiKeyConfiguredByProvider?.() ?? {}
      }
    }
    if (schemaVersion < PUBLIC_SETTINGS_SCHEMA_VERSION) {
      this.repositories.settings.set('app.publicSettingsSchemaVersion', PUBLIC_SETTINGS_SCHEMA_VERSION)
    }
    return {
      ...defaults,
      feishuSyncMode: this.feishuSyncCoordinator.getState().mode,
      ...(this.ports.feishu
        ? { feishuConnected: this.ports.feishu.getConnection().status === 'connected' }
        : {}),
      apiKeyConfiguredByProvider: this.ports.getApiKeyConfiguredByProvider?.() ?? {}
    }
  }

  async getFeishuConnection(): Promise<FeishuConnectionView> {
    const connection = this.ports.feishu?.getConnection() ?? {
      status: 'disconnected',
      baseName: null,
      baseUrl: null,
      lastSyncedAt: null,
      message: '当前版本未配置飞书同步服务',
      customAppConfigured: false,
      maskedAppId: null
    }
    return { ...connection, ...this.feishuSyncCoordinator.getState() }
  }

  async connectFeishuCustomApp(input: FeishuCustomAppConnectionInput): Promise<FeishuConnectionView> {
    if (!this.ports.feishu) throw new Error('FEISHU_UNAVAILABLE')
    return this.completeFeishuConnection(() => this.ports.feishu!.connectCustomApp(input))
  }

  async repairFeishu(selectedAppToken?: string): Promise<FeishuConnectionView> {
    if (!this.ports.feishu) throw new Error('FEISHU_UNAVAILABLE')
    return this.completeFeishuConnection(() => this.ports.feishu!.repair(selectedAppToken))
  }

  async recreateFeishu(): Promise<FeishuConnectionView> {
    if (!this.ports.feishu) throw new Error('FEISHU_UNAVAILABLE')
    return this.completeFeishuConnection(() => this.ports.feishu!.recreate())
  }

  async disconnectFeishu(): Promise<void> {
    if (this.ports.feishu) await this.ports.feishu.disconnect()
  }

  async syncFeishu(): Promise<FeishuConnectionView> {
    if (!this.ports.feishu) throw new Error('FEISHU_UNAVAILABLE')
    await this.feishuSyncCoordinator.syncNow()
    return this.getFeishuConnection()
  }

  private async completeFeishuConnection(
    connect: () => Promise<FeishuConnectionView>
  ): Promise<FeishuConnectionView> {
    const connection = await connect()
    if (connection.status !== 'connected') return this.getFeishuConnection()
    if (this.repositories.works.listAll().length > 0) {
      this.feishuSyncCoordinator.markLocalChange()
    }
    await this.flushFeishuAfterTask()
    return this.getFeishuConnection()
  }

  private async syncFeishuPort(): Promise<void> {
    const feishu = this.ports.feishu
    const status = feishu?.getConnection().status
    if (!feishu) {
      throw new Error('FEISHU_NOT_CONNECTED')
    }
    if (status === 'syncing_data') {
      if (!feishu.waitForActiveDataSync) throw new Error('FEISHU_SYNC_IN_PROGRESS')
      await feishu.waitForActiveDataSync()
      await feishu.syncAll()
      return
    }
    if (status !== 'connected' && status !== 'sync_error') throw new Error('FEISHU_NOT_CONNECTED')
    await feishu.syncAll()
  }

  async flushFeishuAfterTask(): Promise<void> {
    try {
      const status = this.ports.feishu?.getConnection().status
      if (status !== 'connected' && status !== 'sync_error' && status !== 'syncing_data') return
      await this.feishuSyncCoordinator.flushAfterTask()
    } catch {
      this.ports.report?.('error', '飞书同步失败', this.feishuSyncFailureDetail())
    }
  }

  private feishuSyncFailureDetail(): { code: string } {
    return { code: this.feishuSyncCoordinator.getState().lastErrorCode ?? 'FEISHU_SYNC_FAILED' }
  }

  async openFeishuBase(): Promise<void> {
    if (!this.ports.feishu?.openBase) throw new Error('FEISHU_BASE_UNAVAILABLE')
    await this.ports.feishu.openBase()
  }

  async openFeishuDeveloperConsole(): Promise<void> {
    if (!this.ports.feishu?.openDeveloperConsole) throw new Error('FEISHU_UNAVAILABLE')
    await this.ports.feishu.openDeveloperConsole()
  }

  async saveSettings(settings: SettingsInput): Promise<PublicSettings> {
    const {
      apiKey,
      apiKeyConfiguredByProvider: _ignoredApiKeyState,
      dailyTime: _ignoredDailyTime,
      feishuSyncMode,
      ...publicSettings
    } = settings
    if (publicSettings.analysisMaxWorksPerCreator !== undefined && (
      !Number.isInteger(publicSettings.analysisMaxWorksPerCreator)
      || publicSettings.analysisMaxWorksPerCreator < 1
      || publicSettings.analysisMaxWorksPerCreator > 30
    )) throw new Error('INVALID_ANALYSIS_MAX_WORKS')
    if (publicSettings.analysisRecentDays !== undefined && (
      !Number.isInteger(publicSettings.analysisRecentDays)
      || publicSettings.analysisRecentDays < 1
      || publicSettings.analysisRecentDays > 365
    )) throw new Error('INVALID_ANALYSIS_RECENT_DAYS')
    if (publicSettings.feishuSyncRecentDays !== undefined && (
      !Number.isInteger(publicSettings.feishuSyncRecentDays)
      || publicSettings.feishuSyncRecentDays < 1
      || publicSettings.feishuSyncRecentDays > 365
    )) throw new Error('INVALID_FEISHU_SYNC_RECENT_DAYS')
    if (publicSettings.feishuRetentionDays !== undefined && (
      !Number.isInteger(publicSettings.feishuRetentionDays)
      || publicSettings.feishuRetentionDays < 1
      || publicSettings.feishuRetentionDays > 365
    )) throw new Error('INVALID_FEISHU_RETENTION_DAYS')
    if (feishuSyncMode !== undefined && !isFeishuSyncMode(feishuSyncMode)) throw new Error('INVALID_FEISHU_SYNC_MODE')
    if (publicSettings.relativePerformanceMultiplier !== undefined && (
      !Number.isFinite(publicSettings.relativePerformanceMultiplier)
      || publicSettings.relativePerformanceMultiplier < 1
    )) throw new Error('INVALID_RELATIVE_PERFORMANCE_MULTIPLIER')
    if (publicSettings.relativePerformanceSurgeMultiplier !== undefined && (
      !Number.isFinite(publicSettings.relativePerformanceSurgeMultiplier)
      || publicSettings.relativePerformanceSurgeMultiplier < 1
    )) throw new Error('INVALID_RELATIVE_PERFORMANCE_SURGE_MULTIPLIER')
    if (publicSettings.highCollects !== undefined && (
      !Number.isFinite(publicSettings.highCollects)
      || publicSettings.highCollects < 0
    )) throw new Error('INVALID_HIGH_COLLECTS')
    if (publicSettings.highComments !== undefined && (
      !Number.isFinite(publicSettings.highComments)
      || publicSettings.highComments < 0
    )) throw new Error('INVALID_HIGH_COMMENTS')
    if (publicSettings.highShares !== undefined && (
      !Number.isFinite(publicSettings.highShares)
      || publicSettings.highShares < 0
    )) throw new Error('INVALID_HIGH_SHARES')
    if (publicSettings.agentReasoningEffort !== undefined && ![
      'low', 'medium', 'high', 'xhigh', 'max'
    ].includes(publicSettings.agentReasoningEffort)) throw new Error('INVALID_AGENT_REASONING_EFFORT')
    if (apiKey?.trim() && publicSettings.providerId) {
      await this.ports.saveApiKey?.(publicSettings.providerId, apiKey.trim())
    }
    const normalizedAgentSettings = publicSettings.agentModel !== undefined
      ? normalizeAgentModel(publicSettings.agentModel, publicSettings.agentReasoningEffort)
      : {}
    const { feishuSyncMode: _currentFeishuSyncMode, ...currentSettings } = await this.getSettings()
    const merged = {
      ...currentSettings,
      ...publicSettings,
      ...normalizedAgentSettings,
      dailyTime: '08:00'
    }
    this.repositories.transaction(() => {
      this.repositories.settings.set('app.publicSettings', merged)
      if (feishuSyncMode !== undefined) this.feishuSyncCoordinator.setMode(feishuSyncMode)
    })
    if (hasChangedCodexSettings(currentSettings, merged)) this.notifyCodexSettingsChanged()
    return { ...merged, feishuSyncMode: this.feishuSyncCoordinator.getState().mode }
  }

  async restoreRecommendedBehaviorSettings(): Promise<PublicSettings> {
    const saved = this.repositories.settings.get<PublicSettings>('app.publicSettings') ?? {}
    const restored = { ...saved, ...RECOMMENDED_BEHAVIOR_SETTINGS }
    for (const key of RECOMMENDED_CLEAR_KEYS) delete restored[key]

    this.repositories.transaction(() => {
      this.repositories.settings.set('app.publicSettings', restored)
      this.feishuSyncCoordinator.setMode(RECOMMENDED_BEHAVIOR_SETTINGS.feishuSyncMode)
    })

    if (hasChangedCodexSettings(saved, restored)) this.notifyCodexSettingsChanged()

    return this.getSettings()
  }

  async loginDouyin(): Promise<void> {
    await this.ports.login()
  }

  async checkDouyinLogin(): Promise<{ loggedIn: boolean }> {
    const result = await this.probeDouyinLogin()
    if (result.loggedIn && this.firstCaptureParked) {
      if (this.running) this.firstCaptureDeferredWake = true
      else {
        this.firstCaptureParked = false
        this.armFirstCapture()
      }
    }
    return result
  }

  private async probeDouyinLogin(): Promise<{ loggedIn: boolean }> {
    try {
      await this.ports.closeBrowser?.()
      if (!this.ports.isLoggedIn) throw new Error('DOUYIN_LOGIN_PROBE_UNAVAILABLE')
      const loggedIn = await this.ports.isLoggedIn()
      if (this.shuttingDown) return { loggedIn }
      console.info('Douyin login check result', { loggedIn, detail: 'scrapling-engine' })
      await this.saveSettings({ douyinLoggedIn: loggedIn })
      return { loggedIn }
    } catch {
      if (!this.shuttingDown) await this.saveSettings({ douyinLoggedIn: false })
      console.warn('Douyin login check failed', { errorCode: 'DOUYIN_LOGIN_CHECK_FAILED' })
      throw Object.assign(new Error('DOUYIN_LOGIN_CHECK_FAILED'), {
        code: 'DOUYIN_LOGIN_CHECK_FAILED',
        retryable: true
      })
    }
  }

  async logoutDouyin(): Promise<void> {
    if (this.ports.logout) await this.ports.logout()
    await this.saveSettings({ douyinLoggedIn: false })
  }

  async analyzeWork(workId: string): Promise<ManualAnalysisResult> {
    const work = this.repositories.works.get(workId)
    if (!work) return { accepted: false, reason: 'WORK_NOT_FOUND' }
    if (this.repositories.analyses.get(workId)) return { accepted: false, reason: 'ALREADY_ANALYZED' }
    if (this.manuallyProcessingWorkIds.has(workId)) return { accepted: false, reason: 'ANALYSIS_IN_PROGRESS' }
    const settings = await this.getSettings()
    if (!(await this.isSelectedEngineReady(settings))) {
      return { accepted: false, reason: settings.runEngine === 'local-agent' ? 'AGENT_CLI_NOT_FOUND' : 'MODEL_NOT_CONFIGURED' }
    }

    this.manuallyProcessingWorkIds.add(workId)
    this.repositories.jobs.save({
      workId, stage: 'discovered', status: 'running', attemptCount: 1,
      nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString()
    })
    this.emitWorkStateChanged(workId)
    const analysis = settings.runEngine === 'local-agent'
      ? this.ports.runAgentAnalysis!(work, settings)
      : this.processAndSaveWork(work, settings)
    void analysis.catch((error) => {
      const normalized = normalizeRuntimeError(error, 'analysis')
      const safeJob = safeWorkFailure(normalized.jobCode, 'analyzed')
      this.workProgressLabels.delete(workId)
      this.repositories.jobs.save({
        workId, stage: 'analyzed', status: 'failed', attemptCount: 1, nextAttemptAt: null,
        errorCode: safeJob.code,
        errorMessage: safeJob.message, updatedAt: new Date().toISOString()
      })
      this.ports.report?.('error', '手动拆解失败', safeFailureReport(normalized, { stage: 'analysis', workId }))
      this.emitWorkStateChanged(workId)
    }).finally(async () => {
      await this.flushFeishuAfterTask()
      this.manuallyProcessingWorkIds.delete(workId)
      this.emitWorkStateChanged(workId)
      this.notifyIfBusinessIdle()
    })
    return { accepted: true }
  }

  /** One-click rewrite. Follows the engine selected in the top bar: local
   * Codex when runEngine === 'local-agent' (and the Codex CLI is reachable),
   * otherwise the cloud model. Mirrors how analysis is dispatched. */
  async rewriteWork(workId: string, payload: import('../shared/ipc-contract').RewriteRequestView): Promise<import('../shared/ipc-contract').RewriteResultView> {
    const settings = await this.getSettings()
    if (settings.runEngine === 'local-agent' && this.ports.agentRewrite) {
      return this.ports.agentRewrite(workId, payload, settings)
    }
    if (!this.ports.rewriteWork) throw new Error('REWRITE_UNAVAILABLE')
    return this.ports.rewriteWork(workId, payload)
  }

  async runNow(kind: RunRecord['kind'] = 'manual'): Promise<{ accepted: boolean; reason?: string }> {
    return this.runCreators(kind)
  }

  async retryFailedCreators(request: TargetedCreatorRetryRequest): Promise<RunStartResult> {
    const creators = this.resolveTargetedCreators(request)
    if (!creators) return { accepted: false, reason: '所选博主已变化，请刷新失败详情后重试' }
    return this.runCreators('manual', request.creatorIds, {
      owner: 'targeted',
      exactCreators: creators,
      trace: { retryOfRunId: request.runId, targetCreatorIds: [...request.creatorIds] }
    })
  }

  private async runCreators(
    kind: RunRecord['kind'],
    creatorIds?: readonly string[],
    options: {
      owner?: RunSlotOwner
      exactCreators?: ReturnType<AppRepositories['creators']['list']>
      trace?: RunExecutionTrace
    } = {}
  ): Promise<{ accepted: boolean; reason?: string }> {
    const owner = options.owner ?? 'normal'
    const reservation = this.reserveRunSlot(owner)
    if (!reservation) return { accepted: false, reason: this.shuttingDown ? '应用正在退出' : '已有任务正在运行' }
    try {
      let settings: PublicSettings
      try {
        settings = await this.getSettings()
      } catch {
        this.releaseRunSlot(reservation, this.firstCaptureCreatorIds.size > 0 ? 'park' : 'none')
        return { accepted: false, reason: '无法读取运行设置，请稍后重试' }
      }
      if (this.shuttingDown) {
        this.releaseRunSlot(reservation, 'none')
        return { accepted: false, reason: '应用正在退出' }
      }
      let creators = options.exactCreators ?? this.repositories.creators.list()
      .filter((creator) => creator.enabled && creator.profileUrl.startsWith('https://www.douyin.com/user/'))
      .filter((creator) => !creatorIds || creatorIds.includes(creator.id))
    if (options.trace) {
      const current = this.resolveTargetedCreators({ runId: options.trace.retryOfRunId, creatorIds: options.trace.targetCreatorIds })
      if (!current || !sameCreatorSnapshot(options.exactCreators ?? [], current)) {
        this.releaseRunSlot(reservation, 'restore-paused')
        return { accepted: false, reason: '所选博主已变化，请刷新失败详情后重试' }
      }
      creators = current
    }
    if (creators.length === 0) {
      if (owner === 'first-capture') {
        for (const creatorId of creatorIds ?? []) this.firstCaptureCreatorIds.delete(creatorId)
        this.clearFirstCaptureStateIfEmpty()
      }
      this.releaseRunSlot(reservation, 'restore-paused')
      return { accepted: false, reason: '请先添加至少一位博主' }
    }
    if (this.ports.isLoggedIn) {
      try {
        const login = await this.probeDouyinLogin()
        if (!login.loggedIn) {
          this.releaseRunSlot(reservation, this.firstCaptureCreatorIds.size > 0 ? 'park' : 'none')
          return { accepted: false, reason: '抖音登录已失效，请重新登录。' }
        }
      } catch {
        this.releaseRunSlot(reservation, this.firstCaptureCreatorIds.size > 0 ? 'park' : 'none')
        return { accepted: false, reason: '无法确认抖音登录状态，请稍后重试。' }
      }
    }
    if (this.shuttingDown) {
      this.releaseRunSlot(reservation, 'none')
      return { accepted: false, reason: '应用正在退出' }
    }
    if (options.trace) {
      const current = this.resolveTargetedCreators({ runId: options.trace.retryOfRunId, creatorIds: options.trace.targetCreatorIds })
      if (!current || !sameCreatorSnapshot(creators, current)) {
        this.releaseRunSlot(reservation, 'restore-paused')
        return { accepted: false, reason: '所选博主已变化，请刷新失败详情后重试' }
      }
      creators = current
    }
    if (owner === 'first-capture') {
      for (const creatorId of creatorIds ?? []) this.firstCaptureCreatorIds.delete(creatorId)
    } else {
      for (const creator of creators) this.firstCaptureCreatorIds.delete(creator.id)
    }
    this.clearFirstCaptureStateIfEmpty()
    const runId = randomUUID()
    this.runState = {
      runId,
      status: 'running', message: '正在采集公开作品，暂时无需操作', requiresAction: false,
      stages: EMPTY_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'running' as const : 'pending' as const }))
    }
      void this.executeRun(creators, settings, kind, runId, reservation, options.trace)
      return { accepted: true }
    } catch {
      this.releaseRunSlot(reservation, this.firstCaptureCreatorIds.size > 0 ? 'park' : 'none')
      return { accepted: false, reason: '无法准备运行任务，请稍后重试' }
    }
  }

  private resolveTargetedCreators(
    request: TargetedCreatorRetryRequest
  ): ReturnType<AppRepositories['creators']['list']> | null {
    try {
      if (!request.runId || request.creatorIds.length === 0 || request.creatorIds.length > 10 || new Set(request.creatorIds).size !== request.creatorIds.length) return null
      const source = this.repositories.runs.get(request.runId)
      if (!source || !source.summary) return null
      const eligible = new Set(failuresFromSummary(source.summary)
        .filter((failure) => failure?.stage === 'discovery' && typeof failure.creatorId === 'string' && failure.creatorId)
        .map((failure) => failure.creatorId as string))
      if (request.creatorIds.some((id) => !eligible.has(id))) return null
      const creators = request.creatorIds.map((id) => this.repositories.creators.getById(id))
      if (creators.some((creator) => !creator || !creator.enabled || !creator.profileUrl.startsWith('https://www.douyin.com/user/'))) return null
      return creators as ReturnType<AppRepositories['creators']['list']>
    } catch {
      return null
    }
  }

  private clearFirstCaptureStateIfEmpty(): void {
    if (this.firstCaptureCreatorIds.size > 0) return
    this.firstCaptureParked = false
    this.firstCaptureDeferredWake = false
  }

  private async executeRun(
    creators: ReturnType<AppRepositories['creators']['list']>,
    settings: PublicSettings,
    kind: RunRecord['kind'],
    runId: string,
    reservation: RunReservation,
    trace?: RunExecutionTrace
  ): Promise<void> {
    const startedAt = new Date().toISOString()
    let discoveredCount = 0
    let selectedForAnalysisCount = 0
    let analyzedCount = 0
    let partial = false
    let waitingForModel = false
    let discoveryFailed = false
    let analysisFailed = false
    let loginConfirmed = settings.douyinLoggedIn === true
    let failures: RunFailure[] = []
    let feishuFlushAttempted = false
    let activeFailureStage: RunFailure['stage'] = 'discovery'
    let lastBusinessStage: RunFailure['stage'] = 'discovery'
    let loginRequiredSeen = false
    let analyzedWorkIds = new Set<string>()
    const flushFeishuAtTaskBoundary = async (): Promise<void> => {
      if (feishuFlushAttempted) return
      feishuFlushAttempted = true
      await this.flushFeishuAfterTask()
    }
    try {
      analyzedWorkIds = new Set(this.repositories.analyses.list().map((analysis) => analysis.workId))
      this.repositories.runs.save({
        id: runId, kind, status: 'running', startedAt, finishedAt: null,
        summary: trace ? { retryOfRunId: trace.retryOfRunId, targetCreatorIds: [...trace.targetCreatorIds] } : null
      })
      for (const creator of creators) {
        activeFailureStage = 'discovery'
        lastBusinessStage = 'discovery'
        this.ports.report?.('info', '开始采集博主', { creatorId: creator.id })
        let discovered: DiscoveredWork[]
        try {
          const discoveryResult = creator.ownership === 'mine'
            ? await this.ports.discover(creator.id, creator.profileUrl, 'mine')
            : await this.ports.discover(creator.id, creator.profileUrl)
          const works = Array.isArray(discoveryResult) ? discoveryResult : discoveryResult.works
          discovered = selectBaselineWorks(works)
          if (!Array.isArray(discoveryResult)) {
            const name = discoveryResult.creator.name.trim()
            const profileUrl = discoveryResult.creator.profileUrl.trim()
            if (name && name !== '抖音博主' && profileUrl) {
              this.repositories.transaction(() => {
                const previous = this.repositories.creators.getById(creator.id)
                this.repositories.creators.updateMetadata(creator.id, name, profileUrl)
                if (previous && (previous.name !== name || previous.profileUrl !== profileUrl)) {
                  this.feishuSyncCoordinator.markLocalChange()
                }
              })
            }
          }
        } catch (error) {
          const normalized = normalizeRuntimeError(error, 'discovery')
          partial = true
          discoveryFailed = true
          if (normalized.run.code === 'DOUYIN_LOGIN_REQUIRED') {
            loginRequiredSeen = true
            try {
              await this.saveSettings({ douyinLoggedIn: false })
            } catch {
              this.ports.report?.('error', '运行状态保存失败', safeOperationalReport('RUN_STATE_PERSISTENCE_FAILED', { runId }))
            }
          }
          this.ports.report?.('error', '博主采集失败', safeFailureReport(normalized, { stage: 'discovery', creatorId: creator.id, runId }))
          failures.push(createRunFailure(normalized, creator.id, creator.name, 'discovery'))
          continue
        }
        this.ports.report?.('info', '博主采集完成', { creatorId: creator.id, works: discovered.length })
        if (!loginConfirmed) {
          await this.saveSettings({ douyinLoggedIn: true })
          loginConfirmed = true
        }
        const recentDays = settings.analysisRecentDays ?? 30
        for (const work of discovered) {
          const monitored = isPublishedWithinDays(work, recentDays)
          this.repositories.transaction(() => {
            const previousWork = this.repositories.works.findBySource(work.sourceType, work.sourceKey) ?? undefined
            const savedWork = this.repositories.works.upsert(work)
            if (hasWorkSyncChange(previousWork, savedWork)) this.feishuSyncCoordinator.markLocalChange()
            if (work.transcript) {
              this.repositories.artifacts.save({
                workId: work.id, wavPath: null, transcript: work.transcript,
                existingWorkId: null, updatedAt: new Date().toISOString()
              })
            }
            if (monitored) {
              const capturedAt = new Date().toISOString()
              const snapshotId = `${work.id}:${chinaDateKey(capturedAt)}`
              const previousSnapshot = this.repositories.snapshots.listByWork(work.id)
                .find((candidate) => candidate.id === snapshotId)
              const snapshot = {
                id: snapshotId,
                workId: work.id,
                capturedAt: previousSnapshot?.capturedAt ?? capturedAt,
                metrics: work.metrics
              }
              this.repositories.snapshots.create(snapshot)
              if (hasSnapshotSyncChange(previousSnapshot, snapshot)) this.feishuSyncCoordinator.markLocalChange()
            }
          })
          this.emitWorkStateChanged(work.id)
          discoveredCount += 1
        }
        const creatorWorks = this.repositories.works.listByCreator(creator.id)
        const viralWorks = discovered.filter((work) => isPublishedWithinDays(work, recentDays)).filter((work) => {
          const baseline = creatorWorks
            .filter((candidate) => candidate.id !== work.id)
            .slice(0, 30)
            .map((candidate) => calculateEngagement(candidate.metrics))
          return evaluateHighlight(work.metrics, baseline, highlightThresholds(settings)).isHighlight
        })
        const interruptedWorkIds = new Set(this.repositories.jobs.list()
          .filter((job) => job.errorCode === 'APP_INTERRUPTED')
          .map((job) => job.workId))
        const candidates = selectAnalysisCandidates(viralWorks.filter((work) => !interruptedWorkIds.has(work.id)), analyzedWorkIds, {
          recentDays,
          maxWorks: settings.analysisMaxWorksPerCreator ?? 10
        })
        selectedForAnalysisCount += candidates.length
        if (candidates.length === 0) continue
        activeFailureStage = 'analysis'
        lastBusinessStage = 'analysis'
        const engineReady = await this.isSelectedEngineReady(settings)
        if (engineReady) {
          for (const work of candidates) {
            try {
              if (settings.runEngine === 'local-agent' && this.ports.runAgentAnalysis) {
                await this.ports.runAgentAnalysis(work, settings)
              } else {
                await this.processAndSaveWork(work, settings)
              }
              analyzedWorkIds.add(work.id)
              analyzedCount += 1
            } catch (error) {
              const normalized = normalizeRuntimeError(error, 'analysis')
              this.workProgressLabels.delete(work.id)
              partial = true
              analysisFailed = true
              this.repositories.jobs.save({
                workId: work.id, stage: 'analyzed', status: 'failed', attemptCount: 1,
                nextAttemptAt: null,
                errorCode: normalized.jobCode,
                errorMessage: safeWorkFailure(normalized.jobCode, 'analyzed').message, updatedAt: new Date().toISOString()
              })
              this.ports.report?.('error', '作品处理失败', safeFailureReport(normalized, { stage: 'analysis', workId: work.id, runId }))
              failures.push(createRunFailure(normalized, creator.id, creator.name, 'analysis'))
              continue
            }
          }
        } else {
          partial = true
          if (settings.runEngine === 'local-agent') {
            analysisFailed = true
            waitingForModel = true
          } else {
            waitingForModel = true
          }
        }
      }
      const finishedAt = new Date().toISOString()
      activeFailureStage = 'feishu'
      await flushFeishuAtTaskBoundary()
      const feishuConnection = this.ports.feishu?.getConnection()
      const feishuState = this.feishuSyncCoordinator.getState()
      const feishuStatus = feishuConnection?.status
      const feishuConnected = feishuStatus === 'connected' && !feishuState.hasPendingChanges
      const feishuAvailable = feishuStatus === 'connected' || feishuStatus === 'sync_error' || feishuStatus === 'syncing_data'
      const feishuSyncFailed = feishuStatus === 'sync_error' || (feishuStatus === 'connected' && feishuState.lastErrorCode !== null)
      const finalFailures = feishuSyncFailed
        ? [...failures, createRunFailure(normalizeRuntimeError({ code: 'FEISHU_SYNC_FAILED' }, 'feishu'), null, '飞书同步', 'feishu')]
        : failures
      const status = partial || feishuSyncFailed ? 'partial' as const : 'completed' as const
      activeFailureStage = lastBusinessStage
      this.repositories.runs.save({
        id: runId, kind, status, startedAt, finishedAt,
        summary: {
          discovered: discoveredCount, selectedForAnalysis: selectedForAnalysisCount, analyzed: analyzedCount, waitingForModel, failures: finalFailures,
          ...(trace ? { retryOfRunId: trace.retryOfRunId, targetCreatorIds: [...trace.targetCreatorIds] } : {})
        }
      })
      this.lastRunAt = finishedAt
      failures = finalFailures
      const feishuSummary = !feishuAvailable ? '飞书尚未连接'
        : feishuSyncFailed ? '飞书同步尚未完成，请在设置中重试'
          : feishuState.hasPendingChanges ? '飞书有本地更新待同步' : null
      const businessSummary = selectedForAnalysisCount === 0 && !discoveryFailed
        ? '作品采集已完成；没有符合当前规则且尚未分析的作品，本次未执行 AI 拆解'
        : waitingForModel
          ? discoveryFailed
            ? '本次运行部分完成；部分博主采集失败，同时等待模型配置'
            : '已完成作品采集，等待模型配置后进行转写和 AI 拆解'
          : partial ? '本次运行部分完成，请查看失败项后重试' : null
      this.runState = {
        runId,
        status,
        message: businessSummary
          ? feishuSummary ? `${businessSummary}；${feishuSummary}` : businessSummary
          : feishuConnected ? '本次采集、转写、分析和同步已完成'
            : `本地采集、转写和分析已完成；${feishuSummary ?? '飞书尚未连接'}`,
        requiresAction: partial || feishuSyncFailed,
        failures: finalFailures,
        stages: EMPTY_STAGES.map((stage) => ({
          ...stage,
          status: stage.id === 'feishu' && feishuSyncFailed
            ? 'failed' as const
            : ((selectedForAnalysisCount === 0 || waitingForModel) && (stage.id === 'download' || stage.id === 'transcription' || stage.id === 'analysis')) ||
            (discoveryFailed && stage.id === 'discovery') ||
            (analysisFailed && stage.id === 'analysis') ||
            (stage.id === 'feishu' && !feishuConnected)
            ? 'pending' as const
            : 'completed' as const
        }))
      }
    } catch (error) {
      const normalized = normalizeRuntimeError(error, activeFailureStage)
      if (normalized.run.code === 'DOUYIN_LOGIN_REQUIRED') loginRequiredSeen = true
      await flushFeishuAtTaskBoundary()
      this.ports.report?.('error', '运行失败', safeFailureReport(normalized, { stage: activeFailureStage, runId }))
      const finishedAt = new Date().toISOString()
      const failure = createRunFailure(normalized, null, '本次运行', activeFailureStage)
      const finalFailures = [...failures, failure]
      failures = finalFailures
      try {
        this.repositories.runs.save({
          id: runId, kind, status: 'failed', startedAt, finishedAt,
          summary: {
            error: 'RUN_FAILED', discovered: discoveredCount, selectedForAnalysis: selectedForAnalysisCount, analyzed: analyzedCount, failures: finalFailures,
            ...(trace ? { retryOfRunId: trace.retryOfRunId, targetCreatorIds: [...trace.targetCreatorIds] } : {})
          }
        })
      } catch {
        this.ports.report?.('error', '运行状态保存失败', safeOperationalReport('RUN_STATE_PERSISTENCE_FAILED', { runId }))
      }
      this.runState = {
        runId,
        status: 'failed', message: normalized.run.message, requiresAction: true,
        stages: this.runState.stages,
        failures: finalFailures
      }
    } finally {
      this.releaseRunSlot(reservation, loginRequiredSeen ? 'park' : 'wake')
    }
  }

  private async processAndSaveWork(work: Work, settings: PublicSettings): Promise<void> {
    this.ensureRunningWorkJob(work.id)
    this.updateWorkProgress(work.id, { stage: 'discovered', label: '正在准备处理' })
    const processed = await this.ports.processWork(work, settings, (progress) => this.updateWorkProgress(work.id, progress))
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
    this.repositories.transaction(() => {
      const previous = this.repositories.analyses.get(work.id) ?? undefined
      this.repositories.analyses.save(analysis)
      if (hasAnalysisSyncChange(previous, analysis)) this.feishuSyncCoordinator.markLocalChange()
      this.repositories.jobs.save({
        workId: work.id, stage: 'analyzed', status: 'running', attemptCount: 1,
        nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString()
      })
    })
    this.repositories.jobs.save({
      workId: work.id, stage: 'completed', status: 'completed', attemptCount: 1,
      nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString()
    })
    this.workProgressLabels.delete(work.id)
    this.emitWorkStateChanged(work.id)
  }

  private ensureRunningWorkJob(workId: string): void {
    const existing = this.repositories.jobs.get(workId)
    if (existing?.status === 'running') return
    this.repositories.jobs.save({
      workId,
      stage: existing?.status === 'completed' ? 'discovered' : existing?.stage ?? 'discovered',
      status: 'running',
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date().toISOString()
    })
  }

  private updateWorkProgress(workId: string, progress: WorkProcessProgress): void {
    const existing = this.repositories.jobs.get(workId)
    if (existing) {
      this.repositories.jobs.save({
        ...existing,
        stage: progress.stage,
        status: 'running',
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date().toISOString()
      })
    }
    this.workProgressLabels.set(workId, progress.label)
    this.emitWorkStateChanged(workId)
  }

  isBusinessIdle(): boolean {
    return !this.running
      && (this.firstCaptureCreatorIds.size === 0 || this.firstCaptureParked)
      && this.firstCaptureTimer === null
      && this.manuallyProcessingWorkIds.size === 0
  }

  onBusinessIdle(listener: () => void): () => void {
    this.idleListeners.add(listener)
    return () => this.idleListeners.delete(listener)
  }

  async getDashboard(): Promise<DashboardData> {
    const settings = await this.getSettings()
    const localCodexSelected = settings.runEngine === 'local-agent'
    const aiReady = localCodexSelected
      ? await this.isSelectedEngineReady(settings)
      : this.isModelConfigured(settings)
    const creators = this.repositories.creators.list()
    const allWorks = this.repositories.works.listAll()
    const creatorNames = new Map(creators.map((creator) => [creator.id, creator.name]))
    const firstCapturedAt = this.repositories.snapshots.listFirstCapturedAt()
    const snapshotsByWork = this.repositories.snapshots.listAllByWork()
    const now = new Date()
    const weekStart = startOfLocalWeek(now).getTime()
    const previousWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000
    const todayStart = startOfLocalDay(now).getTime()
    const monitoredWorks = allWorks.filter((work) => isPublishedWithinDays(work, settings.analysisRecentDays ?? 30, now))
    const weeklyCollectedWorks = monitoredWorks.filter((work) => {
      const capturedAt = firstCapturedAt.get(work.id)
      return capturedAt !== undefined && Date.parse(capturedAt) >= weekStart
    })
    const radarByWork = new Map<string, RadarEvaluation>()
    for (const work of monitoredWorks) {
      const baseline = allWorks
        .filter((candidate) => candidate.creatorId === work.creatorId && candidate.id !== work.id)
        .slice(0, 30)
        .map((candidate) => calculateEngagement(candidate.metrics))
      radarByWork.set(work.id, evaluateRadarStatus(
        work.metrics,
        snapshotsByWork.get(work.id) ?? [],
        baseline,
        highlightThresholds(settings),
        now
      ))
    }
    const allHighlights = monitoredWorks.flatMap((work) => {
      const radar = radarByWork.get(work.id)
      if (!radar?.highlight.isHighlight || !radar.status) return []
      const savedAnalysis = this.repositories.analyses.get(work.id)
      const parsedAnalysis = savedAnalysis ? AnalysisSchema.safeParse(savedAnalysis.result) : null
      return [{
        id: work.id,
        creatorName: (work.creatorId ? creatorNames.get(work.creatorId) : undefined) ?? '未知博主',
        title: work.title,
        firstCapturedAt: firstCapturedAt.get(work.id) ?? work.publishedAt,
        publishedAt: work.publishedAt,
        likes: work.metrics.likes,
        comments: work.metrics.comments,
        shares: work.metrics.shares,
        collects: work.metrics.collects,
        relativePerformanceMultiplier: radar.highlight.relativePerformanceMultiplier,
        reasons: radar.highlight.reasons,
        radarStatus: radar.status,
        radarEvidence: radar.evidence,
        firstBecameViralAt: radar.firstBecameViralAt,
        originalUrl: work.originalUrl ?? '',
        analysis: parsedAnalysis?.success ? parsedAnalysis.data : null
      }]
    }).sort((left, right) => radarStatusPriority(left.radarStatus) - radarStatusPriority(right.radarStatus) || right.likes - left.likes)
    const weeklyTopics = await this.getWeeklyTopicRanking(allHighlights, new Date(weekStart).toISOString(), settings)
    const analyzedWorks = monitoredWorks.filter((work) => this.repositories.analyses.get(work.id)).length
    const newViralWorks = allHighlights.filter((work) => work.firstBecameViralAt && Date.parse(work.firstBecameViralAt) >= weekStart)
    const todayNewViralWorks = allHighlights.filter((work) => work.firstBecameViralAt && Date.parse(work.firstBecameViralAt) >= todayStart)
    const fastestGrowingWork = allHighlights.flatMap((work) => {
      const growth = weeklyLikeGrowth(snapshotsByWork.get(work.id) ?? [], weekStart)
      return growth ? [{ id: work.id, title: work.title, summary: summarizeGrowthWork(work.title, work.analysis?.topicAngle), ...growth }] : []
    }).sort((left, right) => right.likesGained - left.likesGained || right.growthRatePercent - left.growthRatePercent)[0] ?? null
    return {
      lastRunAt: this.lastRunAt,
      creators: creators.length,
      newWorks: weeklyCollectedWorks.length,
      analyzedWorks,
      run: this.runState,
      services: [
        { id: 'douyin', label: '抖音登录', status: settings.douyinLoggedIn ? 'healthy' : 'action_required', detail: settings.douyinLoggedIn ? '会话已保存' : '尚未登录', actionLabel: settings.douyinLoggedIn ? undefined : '去登录' },
        {
          id: 'ai',
          label: 'AI 拆解',
          status: aiReady ? 'healthy' : 'action_required',
          detail: localCodexSelected
            ? aiReady ? '本地 Codex 已就绪' : '未检测到本地 Codex'
            : aiReady ? '模型已配置' : '尚未配置',
          actionLabel: aiReady ? undefined : '去设置'
        },
        { id: 'feishu', label: '飞书同步', status: settings.feishuConnected ? 'healthy' : 'unavailable', detail: settings.feishuConnected ? '授权有效' : '尚未连接', actionLabel: settings.feishuConnected ? undefined : '去授权' }
      ],
      weekly: {
        collectedWorks: weeklyCollectedWorks.length,
        newViralWorks: newViralWorks.length,
        warmingWorks: allHighlights.filter((work) => work.radarStatus === 'warming').length,
        viralLikesGained: allHighlights.reduce((total, work) => total + likesGainedSince(snapshotsByWork.get(work.id) ?? [], weekStart), 0),
        fastestGrowingWork
      },
      today: {
        newWorks: monitoredWorks.filter((work) => {
          const capturedAt = firstCapturedAt.get(work.id)
          return capturedAt !== undefined && Date.parse(capturedAt) >= todayStart
        }).length,
        newViralWorks: todayNewViralWorks.length,
        warmingWorks: allHighlights.filter((work) => work.radarStatus === 'warming').length,
        coolingWorks: allHighlights.filter((work) => work.radarStatus === 'cooling').length
      },
      highlights: allHighlights,
      topicRanking: weeklyTopics.ranking,
      topicRankingState: weeklyTopics.state,
      topicRankingMessage: weeklyTopics.message
    }
  }

  private isModelConfigured(settings: PublicSettings): boolean {
    return this.ports.isModelConfigured?.() ?? Boolean(
      settings.providerId
      && settings.modelId
    )
  }

  private notifyCodexSettingsChanged(): void {
    try {
      this.ports.onCodexSettingsChanged?.()
    } catch {
      // Settings have committed. Do not misreport a successful save because
      // the optional health-state invalidation observer failed.
    }
  }

  /**
   * Whether the engine selected for 立即运行 is ready to analyze.
   * cloud → a configured model; local-agent → an enabled, running Agent
   * service plus a detectable Codex CLI.
   */
  private async isSelectedEngineReady(settings: PublicSettings): Promise<boolean> {
    if (settings.runEngine === 'local-agent') {
      if (!this.ports.runAgentAnalysis || !this.ports.detectAgentCli) return false
      const agent = await this.ports.detectAgentCli(settings).catch(() => null)
      return Boolean(agent)
    }
    return this.isModelConfigured(settings)
  }

  private getActiveModelIdentity(settings: PublicSettings): ActiveModelIdentity | null {
    return this.ports.getActiveModelIdentity?.() ?? (
      settings.providerId && settings.modelId
        ? {
            profileId: `legacy:${settings.providerId}:${settings.modelId}`,
            providerId: settings.providerId,
            modelId: settings.modelId
          }
        : null
    )
  }

  private getSelectedEngineIdentity(settings: PublicSettings): ActiveModelIdentity | null {
    if (settings.runEngine === 'local-agent') {
      const model = settings.agentModel?.trim() || 'Codex 默认模型'
      const effort = settings.agentReasoningEffort || 'default'
      return {
        profileId: 'local-agent',
        providerId: 'local-agent',
        modelId: `${model}@${effort}`
      }
    }
    return this.getActiveModelIdentity(settings)
  }

  private async getWeeklyTopicRanking(
    highlights: DashboardData['highlights'],
    weekStart: string,
    settings: PublicSettings
  ): Promise<{ ranking: DashboardData['topicRanking']; state: DashboardData['topicRankingState']; message: string }> {
    if (highlights.length < 3) {
      return { ranking: [], state: 'insufficient', message: '本周爆款样本不足，至少 3 条后生成选题排行。' }
    }
    const signature = highlights.map((highlight) => highlight.id).sort().join('|')
    const cacheKey = 'dashboard.weeklyTopicClustering'
    const cached = this.repositories.settings.get<WeeklyTopicCache>(cacheKey)
    const identity = this.getSelectedEngineIdentity(settings)
    const engineReady = settings.runEngine === 'local-agent'
      ? await this.isSelectedEngineReady(settings)
      : this.isModelConfigured(settings)
    const configured = Boolean(engineReady
      && identity
      && (settings.runEngine === 'local-agent'
        || this.ports.isModelConfigured !== undefined
        || Boolean(settings.apiKeyConfiguredByProvider?.[settings.providerId!]))
      && this.ports.clusterWeeklyTopics)
    if (!configured || !identity) {
      return {
        ranking: [],
        state: 'unconfigured',
        message: settings.runEngine === 'local-agent'
          ? '请先安装并登录 Codex，然后在设置中检测是否可用。'
          : '请先在设置中配置云端模型和 API Key。'
      }
    }
    if (cached?.weekStart === weekStart && cached.signature === signature
      && hasSameModelIdentity(cached, identity)) {
      return { ranking: buildTopicRanking(cached.result, highlights, Date.parse(weekStart)), state: 'ready', message: '' }
    }
    const works: WeeklyTopicWork[] = highlights.map((highlight) => ({
      id: highlight.id,
      title: highlight.title,
      topicAngle: highlight.analysis?.topicAngle ?? '',
      viralPoints: highlight.analysis?.viralPoints ?? []
    }))
    const requestKey = weeklyTopicClusteringKey(signature, identity)
    try {
      const promise = this.weeklyTopicClustering?.key === requestKey
        ? this.weeklyTopicClustering.promise
        : this.ports.clusterWeeklyTopics!(works, settings)
      this.weeklyTopicClustering = { key: requestKey, promise }
      const result = await promise
      const currentIdentity = this.getSelectedEngineIdentity(settings)
      if (currentIdentity && hasSameModelIdentity(currentIdentity, identity)) {
        this.repositories.settings.set(cacheKey, {
          weekStart,
          signature,
          profileId: identity.profileId,
          providerId: identity.providerId,
          modelId: identity.modelId,
          createdAt: new Date().toISOString(),
          result
        } satisfies WeeklyTopicCache)
      }
      return { ranking: buildTopicRanking(result, highlights, Date.parse(weekStart)), state: 'ready', message: '' }
    } catch {
      this.ports.report?.('error', '本周选题聚类失败', safeOperationalReport('WEEKLY_TOPIC_CLUSTERING_FAILED', {}))
      return { ranking: [], state: 'failed', message: '本周选题归类失败，请检查 AI 设置后刷新重试。' }
    } finally {
      if (this.weeklyTopicClustering?.key === requestKey) this.weeklyTopicClustering = null
    }
  }
}

interface WeeklyTopicCache {
  weekStart: string
  signature: string
  profileId: string
  providerId: string
  modelId: string
  createdAt: string
  result: WeeklyTopicClusterResult
}

function hasSameModelIdentity(left: ActiveModelIdentity, right: ActiveModelIdentity): boolean {
  return left.profileId === right.profileId
    && left.providerId === right.providerId
    && left.modelId === right.modelId
}

function hasChangedCodexSettings(previous: PublicSettings, next: PublicSettings): boolean {
  return previous.agentModel !== next.agentModel
    || previous.agentReasoningEffort !== next.agentReasoningEffort
}

function weeklyTopicClusteringKey(signature: string, identity: ActiveModelIdentity): string {
  return JSON.stringify([signature, identity.profileId, identity.providerId, identity.modelId])
}

function buildTopicRanking(
  result: WeeklyTopicClusterResult,
  highlights: DashboardData['highlights'],
  weekStart: number
): DashboardData['topicRanking'] {
  const byId = new Map(highlights.map((highlight) => [highlight.id, highlight]))
  return result.categories.map((category) => {
    const works = category.workIds.map((id) => byId.get(id)).filter((work): work is DashboardData['highlights'][number] => Boolean(work))
    const representative = [...works].sort((left, right) => right.likes - left.likes)[0]
    if (!representative) throw new Error('WEEKLY_TOPIC_CATEGORY_EMPTY')
    return {
      topic: category.name,
      viralWorks: works.length,
      totalLikes: works.reduce((total, work) => total + work.likes, 0),
      workIds: works.map((work) => work.id),
      newThisWeek: works.filter((work) => work.firstBecameViralAt && Date.parse(work.firstBecameViralAt) >= weekStart).length,
      previousWeekNew: works.filter((work) => {
        if (!work.firstBecameViralAt) return false
        const timestamp = Date.parse(work.firstBecameViralAt)
        return timestamp >= weekStart - 7 * 24 * 60 * 60 * 1000 && timestamp < weekStart
      }).length,
      weekOverWeekDelta: 0,
      representativeWorkId: representative.id,
      representativeTitle: representative.title
    }
  }).map((item) => ({ ...item, weekOverWeekDelta: item.newThisWeek - item.previousWeekNew }))
    .sort((left, right) => right.newThisWeek - left.newThisWeek || right.viralWorks - left.viralWorks || right.totalLikes - left.totalLikes)
}

function startOfLocalWeek(now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

function startOfLocalDay(now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start
}

function isPublishedWithinDays(work: Work, days: number, now = new Date()): boolean {
  const publishedAt = Date.parse(work.publishedAt)
  const age = now.getTime() - publishedAt
  return Number.isFinite(publishedAt) && age >= 0 && age <= days * 24 * 60 * 60 * 1000
}

function likesGainedSince(snapshots: readonly MetricSnapshotRecord[], since: number): number {
  const ordered = [...snapshots].filter((snapshot) => Date.parse(snapshot.capturedAt) <= Date.now())
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
  if (ordered.length < 2) return 0
  const latest = ordered.at(-1)!
  const baseline = [...ordered].reverse().find((snapshot) => Date.parse(snapshot.capturedAt) < since)
    ?? ordered.find((snapshot) => Date.parse(snapshot.capturedAt) >= since)
  return baseline ? Math.max(0, latest.metrics.likes - baseline.metrics.likes) : 0
}

function weeklyLikeGrowth(snapshots: readonly MetricSnapshotRecord[], since: number): { likesGained: number; growthRatePercent: number } | null {
  const ordered = [...snapshots].filter((snapshot) => Date.parse(snapshot.capturedAt) <= Date.now())
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
  if (ordered.length < 2) return null
  const latest = ordered.at(-1)!
  const baseline = [...ordered].reverse().find((snapshot) => Date.parse(snapshot.capturedAt) < since)
    ?? ordered.find((snapshot) => Date.parse(snapshot.capturedAt) >= since)
  if (!baseline || baseline.capturedAt === latest.capturedAt || baseline.metrics.likes <= 0) return null
  const likesGained = latest.metrics.likes - baseline.metrics.likes
  if (likesGained <= 0) return null
  return {
    likesGained,
    growthRatePercent: Math.round(likesGained / baseline.metrics.likes * 1000) / 10
  }
}

function summarizeGrowthWork(title: string, topicAngle?: string): string {
  const source = (topicAngle?.trim() || title.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim()) || '点击查看作品'
  return source.length > 28 ? `${source.slice(0, 28)}…` : source
}

function radarStatusPriority(status: DashboardData['highlights'][number]['radarStatus']): number {
  return status ? { newly_viral: 0, warming: 1, strong: 2, watching: 3, cooling: 4 }[status] : 5
}

function highlightThresholds(settings: PublicSettings): {
  absoluteLikes: number
  highCollects: number
  highComments: number
  highShares: number
  relativePerformanceSurgeMultiplier: number
  relativePerformanceMultiplier: number
  minimumRelativeLikes: number
} {
  return {
    absoluteLikes: settings.absoluteLikes ?? 10_000,
    highCollects: settings.highCollects ?? 3_000,
    highComments: settings.highComments ?? 500,
    highShares: settings.highShares ?? 500,
    relativePerformanceSurgeMultiplier: settings.relativePerformanceSurgeMultiplier ?? 80,
    relativePerformanceMultiplier: settings.relativePerformanceMultiplier ?? 3,
    minimumRelativeLikes: 100
  }
}

function createRunFailure(
  normalized: Readonly<NormalizedRuntimeError>,
  creatorId: string | null,
  creatorName: string,
  stage: RunFailure['stage']
): RunFailure {
  return {
    creatorId,
    creatorName,
    stage,
    code: normalized.run.code,
    message: normalized.run.message,
    occurredAt: new Date().toISOString()
  }
}

function numberFromSummary(summary: Record<string, unknown> | null, key: string): number {
  const value = summary?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function failuresFromSummary(summary: Record<string, unknown> | null): RunFailure[] {
  return Array.isArray(summary?.failures) ? summary.failures as RunFailure[] : []
}

function sameCreatorSnapshot(
  left: ReturnType<AppRepositories['creators']['list']>,
  right: ReturnType<AppRepositories['creators']['list']>
): boolean {
  return left.length === right.length && left.every((creator, index) => {
    const current = right[index]
    return current?.id === creator.id
      && current.enabled === creator.enabled
      && current.profileUrl === creator.profileUrl
      && current.ownership === creator.ownership
  })
}
