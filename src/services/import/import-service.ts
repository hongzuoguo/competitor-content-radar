import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Work } from '../../core/domain'
import type { WorkflowStage } from '../../core/workflow'
import type { ProcessedWork } from '../../main/runtime'
import type { AppRepositories, JobRecord } from '../database/repositories'
import type { DouyinVideoDescriptor } from './douyin-video-source'
import type { ImportedMedia } from './local-file-source'
import { ConcurrencyGate, PIPELINE_CONCURRENCY } from '../pipeline/job-queue'
import { ImportError } from './import-errors'

export type ImportRequest =
  | { type: 'local'; path: string; creatorId: string | null }
  | { type: 'douyin'; url: string; creatorId: string | null }

export type ImportStartResult =
  | { accepted: true; workId: string }
  | { accepted: false; reason: 'duplicate'; existingWorkId: string }

type AnalysisOutput = Omit<ProcessedWork, 'transcript'>

export interface WorkProcessor {
  extractAudio(workId: string, mediaPath: string): Promise<string>
  transcribe(workId: string, wavPath: string): Promise<string>
  analyze(workId: string, transcript: string, settings: unknown): Promise<AnalysisOutput>
}

export interface ImportServiceDependencies {
  repositories: AppRepositories
  mediaRoot: string
  ingestLocal(path: string, mediaRoot: string): Promise<ImportedMedia>
  resolveDouyin(url: string): Promise<DouyinVideoDescriptor>
  download(url: string, destination: string): Promise<unknown>
  processor: WorkProcessor
  getSettings(): unknown
  report?(level: 'info' | 'error', message: string, detail?: unknown): void
}

const now = () => new Date().toISOString()

export class ImportService {
  private readonly active = new Set<string>()
  private readonly downloadGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.download)
  private readonly transcriptionGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.transcription)
  private readonly analysisGate = new ConcurrencyGate(PIPELINE_CONCURRENCY.analysis)

  constructor(private readonly dependencies: ImportServiceDependencies) {}

  async start(request: ImportRequest): Promise<ImportStartResult> {
    this.validateCreator(request.creatorId)
    const source = request.type === 'local'
      ? await this.dependencies.ingestLocal(request.path, this.dependencies.mediaRoot)
      : await this.dependencies.resolveDouyin(request.url)
    const duplicate = this.dependencies.repositories.works.findBySource(source.sourceType, source.sourceKey)
    if (duplicate) return { accepted: false, reason: 'duplicate', existingWorkId: duplicate.id }

    const workId = randomUUID()
    const work: Work = {
      id: workId, creatorId: request.creatorId, platformWorkId: null,
      sourceType: source.sourceType, sourceKey: source.sourceKey,
      mediaPath: 'mediaPath' in source ? source.mediaPath : null,
      title: source.title, publishedAt: now(), originalUrl: source.originalUrl,
      downloadUrl: 'downloadUrl' in source ? source.downloadUrl : null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    const initialStage: WorkflowStage = request.type === 'local' ? 'downloaded' : 'discovered'
    this.dependencies.repositories.transaction(() => {
      this.dependencies.repositories.works.upsert(work)
      this.dependencies.repositories.jobs.save(this.job(workId, initialStage, 'running', 1))
    })
    this.launch(workId)
    return { accepted: true, workId }
  }

  async retry(workId: string): Promise<ImportStartResult> {
    const job = this.dependencies.repositories.jobs.get(workId)
    if (!job || job.status === 'completed') throw new ImportError('JOB_NOT_RETRYABLE', 'This job cannot be retried.')
    if (job.status === 'running' || this.active.has(workId)) throw new ImportError('RUN_ALREADY_ACTIVE', 'This job is already running.')
    this.dependencies.repositories.jobs.save({ ...job, status: 'running', attemptCount: job.attemptCount + 1, errorCode: null, errorMessage: null, updatedAt: now() })
    this.launch(workId)
    return { accepted: true, workId }
  }

  private validateCreator(creatorId: string | null): void {
    if (creatorId !== null && !this.dependencies.repositories.creators.getById(creatorId)) {
      throw new ImportError('INVALID_CREATOR', 'The selected creator does not exist.')
    }
  }

  private launch(workId: string): void {
    this.active.add(workId)
    void this.process(workId).catch((error: unknown) => {
      const existing = this.dependencies.repositories.jobs.get(workId)
      if (existing) this.dependencies.repositories.jobs.save({
        ...existing, status: 'failed', errorCode: errorCode(error),
        errorMessage: 'Import processing failed.', updatedAt: now()
      })
      this.dependencies.report?.('error', 'Import processing failed', error)
    }).finally(() => this.active.delete(workId))
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
      repositories.works.setMediaPath(workId, mediaPath)
      this.stage(workId, 'downloaded')
      work = repositories.works.get(workId)!
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'downloaded') {
      if (!work.mediaPath) throw Object.assign(new Error('Media unavailable'), { code: 'MEDIA_MISSING' })
      const wavPath = await this.dependencies.processor.extractAudio(workId, work.mediaPath)
      artifacts = { workId, wavPath, transcript: artifacts?.transcript ?? null, updatedAt: now() }
      repositories.artifacts.save(artifacts)
      this.stage(workId, 'audio_extracted')
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'audio_extracted') {
      const wavPath = artifacts?.wavPath
      if (!wavPath) throw Object.assign(new Error('Audio unavailable'), { code: 'AUDIO_MISSING' })
      const transcript = await this.transcriptionGate.run(() => this.dependencies.processor.transcribe(workId, wavPath))
      artifacts = { workId, wavPath, transcript, updatedAt: now() }
      repositories.artifacts.save(artifacts)
      this.stage(workId, 'transcribed')
      job = repositories.jobs.get(workId)!
    }
    if (job.stage === 'transcribed') {
      const transcript = artifacts?.transcript
      if (transcript === null || transcript === undefined) throw Object.assign(new Error('Transcript unavailable'), { code: 'TRANSCRIPT_MISSING' })
      const output = await this.analysisGate.run(() => this.dependencies.processor.analyze(workId, transcript, this.dependencies.getSettings()))
      repositories.analyses.save({ workId, transcript, ...output, createdAt: now() })
      this.stage(workId, 'analyzed')
    }
    this.stage(workId, 'completed', 'completed')
  }

  private stage(workId: string, stage: WorkflowStage, status: JobRecord['status'] = 'running'): void {
    const job = this.dependencies.repositories.jobs.get(workId)
    if (!job) throw new Error('IMPORT_JOB_MISSING')
    this.dependencies.repositories.jobs.save({ ...job, stage, status, errorCode: null, errorMessage: null, updatedAt: now() })
  }

  private job(workId: string, stage: WorkflowStage, status: JobRecord['status'], attemptCount: number): JobRecord {
    return { workId, stage, status, attemptCount, nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: now() }
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'PIPELINE_STAGE_FAILED'
}
