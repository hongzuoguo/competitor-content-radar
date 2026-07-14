import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { Work } from '../../core/domain'
import type { WorkflowStage } from '../../core/workflow'
import type { ProcessedWork } from '../../main/runtime'
import type { AppRepositories, JobRecord } from '../database/repositories'
import type { DouyinVideoDescriptor } from './douyin-video-source'
import type { ImportedMedia } from './local-file-source'
import { ConcurrencyGate, PIPELINE_CONCURRENCY } from '../pipeline/job-queue'
import { ImportError } from './import-errors'
import type { ImportRequest, ImportStartResult } from '../../shared/ipc-contract'
import { removeManagedWorkDirectory as defaultRemoveManagedWorkDirectory } from '../media/remove-work-directory'
export type { ImportRequest, ImportStartResult } from '../../shared/ipc-contract'

type AnalysisOutput = Omit<ProcessedWork, 'transcript'>

export interface WorkProcessor {
  extractAudio(workId: string, mediaPath: string): Promise<string>
  transcribe(workId: string, wavPath: string): Promise<string>
  analyze(workId: string, transcript: string, settings: unknown): Promise<AnalysisOutput>
}

export interface ImportTerminalNotification {
  workId: string
  status: 'completed' | 'failed'
  stage: WorkflowStage
  errorCode: string | null
  retryable: boolean
}

export interface ImportNotificationPort {
  notify(notification: ImportTerminalNotification): Promise<void> | void
}

export interface ImportServiceDependencies {
  repositories: AppRepositories
  mediaRoot: string
  ingestLocal(path: string, mediaRoot: string): Promise<ImportedMedia>
  resolveDouyin(url: string): Promise<DouyinVideoDescriptor>
  download(url: string, destination: string): Promise<unknown>
  processor: WorkProcessor
  getSettings(): unknown
  notification?: ImportNotificationPort
  afterSettled?(): Promise<void> | void
  removeManagedWorkDirectory?(mediaRoot: string, workId: string): Promise<void>
  report?(level: 'info' | 'error', message: string, detail?: unknown): void
}

const now = () => new Date().toISOString()

export class ImportService {
  private readonly active = new Set<string>()
  private readonly activePromises = new Map<string, Promise<void>>()
  private readonly pendingRequests = new Map<string, ImportRequest>()
  private readonly deleting = new Set<string>()
  private shuttingDown = false
  private readonly downloadGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.download)
  private readonly transcriptionGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.transcription)
  private readonly analysisGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.analysis)
  private readonly listeners = new Set<(workId: string) => void>()

  constructor(private readonly dependencies: ImportServiceDependencies) {}

  subscribe(listener: (workId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isRetryable(workId: string): boolean {
    const job = this.dependencies.repositories.jobs.get(workId)
    const work = this.dependencies.repositories.works.get(workId)
    return isImportRetryable(job, work)
  }

  async start(request: ImportRequest): Promise<ImportStartResult> {
    if (this.shuttingDown) throw new ImportError('APP_SHUTTING_DOWN', 'The application is shutting down.')
    const creatorId = request.creatorId ?? null
    this.validateCreator(creatorId)
    const input = request.source.type === 'local' ? request.source.path : request.source.url
    if (!input.trim()) throw new ImportError('INVALID_IMPORT_INPUT', 'An import source is required.')
    const workId = randomUUID()
    const work: Work = {
      id: workId, creatorId, platformWorkId: null,
      sourceType: request.source.type === 'local' ? 'local_file' : 'douyin_url',
      sourceKey: `pending:${workId}`, mediaPath: null,
      title: request.source.type === 'local' ? basename(request.source.path) : 'Douyin video',
      publishedAt: now(), originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    this.dependencies.repositories.transaction(() => {
      this.dependencies.repositories.works.upsert(work)
      this.dependencies.repositories.jobs.save(this.job(workId, 'discovered', 'running', 1))
    })
    this.emit(workId)
    this.pendingRequests.set(workId, request)
    this.launch(workId, request)
    return { accepted: true, workId }
  }

  async retry(workId: string): Promise<ImportStartResult> {
    if (this.shuttingDown) throw new ImportError('APP_SHUTTING_DOWN', 'The application is shutting down.')
    if (this.deleting.has(workId)) {
      throw new ImportError('WORK_DELETE_NOT_ALLOWED', 'This failed work is being deleted.')
    }
    const job = this.dependencies.repositories.jobs.get(workId)
    const work = this.dependencies.repositories.works.get(workId)
    if (job?.status === 'running' || this.active.has(workId)) throw new ImportError('RUN_ALREADY_ACTIVE', 'This job is already running.')
    if (!job || !work || !this.isRetryable(workId)) {
      throw new ImportError('JOB_NOT_RETRYABLE', 'This job cannot be retried.')
    }
    this.dependencies.repositories.jobs.save({ ...job, status: 'running', attemptCount: job.attemptCount + 1, errorCode: null, errorMessage: null, updatedAt: now() })
    this.emit(workId)
    this.launch(workId, this.pendingRequests.get(workId))
    return { accepted: true, workId }
  }

  async deleteFailed(workId: string): Promise<void> {
    if (this.deleting.has(workId)) {
      throw new ImportError('WORK_DELETE_NOT_ALLOWED', 'This failed work is already being deleted.')
    }
    const work = this.dependencies.repositories.works.get(workId)
    const job = this.dependencies.repositories.jobs.get(workId)
    if (!work || !job) {
      throw new ImportError('FAILED_WORK_NOT_FOUND', 'The failed work was not found.')
    }
    if (this.shuttingDown || this.active.has(workId) || job.status !== 'failed') {
      throw new ImportError('WORK_DELETE_NOT_ALLOWED', 'Only inactive failed work can be deleted.')
    }

    this.deleting.add(workId)
    try {
      try {
        const removeWorkDirectory = this.dependencies.removeManagedWorkDirectory ?? defaultRemoveManagedWorkDirectory
        await removeWorkDirectory(this.dependencies.mediaRoot, workId)
      } catch (error) {
        throw new ImportError('FAILED_WORK_FILE_CLEANUP_FAILED', 'Failed work files could not be removed.', { cause: error })
      }

      this.dependencies.repositories.transaction(() => {
        this.dependencies.repositories.works.delete(workId)
      })
      this.pendingRequests.delete(workId)
      this.emit(workId)
    } finally {
      this.deleting.delete(workId)
    }
  }

  reconcileInterruptedJobs(): void {
    for (const job of this.dependencies.repositories.jobs.list()) {
      if (job.status !== 'running' || this.active.has(job.workId)) continue
      const work = this.dependencies.repositories.works.get(job.workId)
      const artifacts = this.dependencies.repositories.artifacts.get(job.workId)
      const sourceInputRequired = !work || work.sourceKey.startsWith('pending:') ||
        (!work.mediaPath && !work.downloadUrl && !artifacts?.wavPath && artifacts?.transcript == null)
      this.dependencies.repositories.jobs.save({
        ...job,
        status: 'failed',
        errorCode: sourceInputRequired ? 'SOURCE_INPUT_REQUIRED' : 'APP_INTERRUPTED',
        errorMessage: sourceInputRequired
          ? '导入来源未准备完成，请重新导入。'
          : '应用在处理期间退出，请重试此任务。',
        updatedAt: now()
      })
      this.emit(job.workId)
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    await Promise.all([...this.activePromises.values()])
  }

  private validateCreator(creatorId: string | null): void {
    if (creatorId !== null && !this.dependencies.repositories.creators.getById(creatorId)) {
      throw new ImportError('INVALID_CREATOR', 'The selected creator does not exist.')
    }
  }

  private launch(workId: string, request?: ImportRequest): void {
    this.active.add(workId)
    const operation = this.prepareAndProcess(workId, request)
    const terminal = operation.catch(async (error: unknown) => {
      const code = errorCode(error)
      let stage: WorkflowStage = 'discovered'
      try {
        const existing = this.dependencies.repositories.jobs.get(workId)
        stage = existing?.stage ?? stage
        if (existing) this.dependencies.repositories.jobs.save({
          ...existing, status: 'failed', errorCode: code,
          errorMessage: 'Import processing failed.', updatedAt: now()
        })
        if (existing) this.emit(workId)
      } catch {
        // Shutdown waits for this terminal chain before the database is closed.
      }
      await this.notifyTerminal(workId, 'failed', stage, code)
      try {
        this.dependencies.report?.('error', 'Import processing failed', { workId, stage, errorCode: code })
      } catch {
        // Logging failures must not create an unhandled rejection.
      }
    }).catch(() => undefined).finally(async () => {
      this.active.delete(workId)
      if (this.active.size === 0) {
        try {
          await this.dependencies.afterSettled?.()
        } catch {
          // Cleanup is best-effort and cannot change persisted job state.
        }
      }
      this.activePromises.delete(workId)
      this.pendingRequests.delete(workId)
    })
    this.activePromises.set(workId, terminal)
  }

  private async prepareAndProcess(workId: string, request?: ImportRequest): Promise<void> {
    const work = this.dependencies.repositories.works.get(workId)
    if (!work) throw new Error('IMPORT_RECORD_MISSING')
    if (work.sourceKey.startsWith('pending:')) {
      if (!request) throw Object.assign(new Error('Preparation input unavailable'), { code: 'IMPORT_PREPARATION_MISSING' })
      let source: ImportedMedia | DouyinVideoDescriptor
      try {
        source = request.source.type === 'local'
          ? await this.dependencies.ingestLocal(request.source.path, this.dependencies.mediaRoot)
          : await this.dependencies.resolveDouyin(request.source.url)
      } catch (error) {
        if (request.source.type === 'douyin_url' && error instanceof ImportError && error.partialSource) {
          const duplicate = this.dependencies.repositories.works.findBySource('douyin_url', error.partialSource.sourceKey)
          if (duplicate && duplicate.id !== workId) {
            this.recordDuplicate(workId, duplicate.id)
            return
          }
          this.dependencies.repositories.works.finalizeSource(workId, {
            ...error.partialSource,
            mediaPath: null,
            downloadUrl: null
          })
          this.emit(workId)
        }
        throw error
      }
      const duplicate = this.dependencies.repositories.works.findBySource(source.sourceType, source.sourceKey)
      if (duplicate && duplicate.id !== workId) {
        this.recordDuplicate(workId, duplicate.id)
        return
      }
      try {
        this.dependencies.repositories.transaction(() => {
          this.dependencies.repositories.works.finalizeSource(workId, {
            sourceKey: source.sourceKey,
            mediaPath: 'mediaPath' in source ? source.mediaPath : null,
            title: source.title,
            originalUrl: source.originalUrl,
            downloadUrl: 'downloadUrl' in source ? source.downloadUrl : null
          })
          this.stage(workId, request.source.type === 'local' ? 'downloaded' : 'discovered')
        })
        this.emit(workId)
      } catch (error) {
        const racedDuplicate = this.dependencies.repositories.works.findBySource(source.sourceType, source.sourceKey)
        if (!racedDuplicate || racedDuplicate.id === workId) throw error
        this.recordDuplicate(workId, racedDuplicate.id)
        return
      }
    }
    await this.process(workId)
  }

  private recordDuplicate(workId: string, existingWorkId: string): void {
    this.dependencies.repositories.transaction(() => {
      const artifacts = this.dependencies.repositories.artifacts.get(workId)
      this.dependencies.repositories.artifacts.save({
        workId, wavPath: artifacts?.wavPath ?? null, transcript: artifacts?.transcript ?? null,
        existingWorkId, updatedAt: now()
      })
      const job = this.dependencies.repositories.jobs.get(workId)
      if (!job) throw new Error('IMPORT_JOB_MISSING')
      this.dependencies.repositories.jobs.save({
        ...job, status: 'failed', errorCode: 'IMPORT_DUPLICATE',
        errorMessage: 'This import already exists.', updatedAt: now()
      })
    })
    this.emit(workId)
  }

  private async process(workId: string): Promise<void> {
    const repositories = this.dependencies.repositories
    let work = repositories.works.get(workId)
    let job = repositories.jobs.get(workId)
    if (!work || !job) throw new Error('IMPORT_RECORD_MISSING')
    let artifacts = repositories.artifacts.get(workId)

    if (job.stage === 'discovered') {
      if (!work.downloadUrl) throw Object.assign(new Error('Download unavailable'), { code: 'DOUYIN_MEDIA_URL_MISSING' })
      const mediaPath = join(this.dependencies.mediaRoot, workId, 'video.mp4')
      await this.downloadGate.run(() => this.dependencies.download(work!.downloadUrl!, mediaPath).then(() => undefined))
      repositories.transaction(() => {
        repositories.works.setMediaPath(workId, mediaPath)
        this.stage(workId, 'downloaded')
      })
      this.emit(workId)
      work = repositories.works.get(workId)!
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'downloaded') {
      if (!work.mediaPath) throw Object.assign(new Error('Media unavailable'), { code: 'MEDIA_MISSING' })
      const wavPath = await this.dependencies.processor.extractAudio(workId, work.mediaPath)
      artifacts = { workId, wavPath, transcript: artifacts?.transcript ?? null, existingWorkId: null, updatedAt: now() }
      repositories.transaction(() => {
        repositories.artifacts.save(artifacts!)
        this.stage(workId, 'audio_extracted')
      })
      this.emit(workId)
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'audio_extracted') {
      const wavPath = artifacts?.wavPath
      if (!wavPath) throw Object.assign(new Error('Audio unavailable'), { code: 'AUDIO_MISSING' })
      const transcript = await this.transcriptionGate.run(() => this.dependencies.processor.transcribe(workId, wavPath))
      artifacts = { workId, wavPath, transcript, existingWorkId: null, updatedAt: now() }
      repositories.transaction(() => {
        repositories.artifacts.save(artifacts!)
        this.stage(workId, 'transcribed')
      })
      this.emit(workId)
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'transcribed') {
      const transcript = artifacts?.transcript
      if (transcript === null || transcript === undefined) throw Object.assign(new Error('Transcript unavailable'), { code: 'TRANSCRIPT_MISSING' })
      const output = await this.analysisGate.run(() => this.dependencies.processor.analyze(workId, transcript, this.dependencies.getSettings()))
      repositories.transaction(() => {
        repositories.analyses.save({ workId, transcript, ...output, createdAt: now() })
        this.stage(workId, 'completed', 'completed')
      })
      this.emit(workId)
      await this.notifyTerminal(workId, 'completed', 'completed', null)
      return
    }
    this.stage(workId, 'completed', 'completed')
    this.emit(workId)
  }

  private stage(workId: string, stage: WorkflowStage, status: JobRecord['status'] = 'running'): void {
    const job = this.dependencies.repositories.jobs.get(workId)
    if (!job) throw new Error('IMPORT_JOB_MISSING')
    this.dependencies.repositories.jobs.save({ ...job, stage, status, errorCode: null, errorMessage: null, updatedAt: now() })
  }

  private job(workId: string, stage: WorkflowStage, status: JobRecord['status'], attemptCount: number): JobRecord {
    return { workId, stage, status, attemptCount, nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: now() }
  }

  private emit(workId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(workId)
      } catch {
        // A destroyed renderer must not affect committed import state.
      }
    }
  }

  private async notifyTerminal(
    workId: string,
    status: ImportTerminalNotification['status'],
    stage: WorkflowStage,
    errorCode: string | null
  ): Promise<void> {
    if (!this.dependencies.notification) return
    try {
      await this.dependencies.notification.notify({
        workId,
        status,
        stage,
        errorCode,
        retryable: status === 'failed' && this.isRetryable(workId)
      })
    } catch {
      // Desktop notifications are optional and must never fail an import.
    }
  }
}

export function isImportRetryable(job: JobRecord | null, work: Work | null): boolean {
  return Boolean(job && work && job.status === 'failed' && job.errorCode !== 'IMPORT_DUPLICATE' &&
    job.errorCode !== 'SOURCE_INPUT_REQUIRED' && !work.sourceKey.startsWith('pending:'))
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'PIPELINE_STAGE_FAILED'
}
