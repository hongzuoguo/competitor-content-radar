import type Database from 'better-sqlite3'
import type { Creator, Work, WorkSourceType } from '../../core/domain'
import type { WorkflowStage } from '../../core/workflow'

export interface MetricSnapshotRecord {
  id: string
  workId: string
  capturedAt: string
  metrics: Work['metrics']
}

export interface AnalysisRecord {
  workId: string
  transcript: string
  result: Record<string, unknown>
  provider: string
  model: string
  promptVersion: string
  tokenUsage: Record<string, number> | null
  createdAt: string
}

export interface RunRecord {
  id: string
  kind: 'daily' | 'weekly' | 'manual' | 'catch_up'
  status: 'running' | 'completed' | 'failed' | 'partial'
  startedAt: string
  finishedAt: string | null
  summary: Record<string, unknown> | null
}

export interface JobRecord {
  workId: string
  stage: WorkflowStage
  status: 'pending' | 'running' | 'completed' | 'failed'
  attemptCount: number
  nextAttemptAt: string | null
  errorCode: string | null
  errorMessage: string | null
  updatedAt: string
}

export interface JobArtifactRecord {
  workId: string
  wavPath: string | null
  transcript: string | null
  existingWorkId: string | null
  updatedAt: string
}

function mapCreator(row: Record<string, unknown>): Creator {
  return {
    id: String(row.id),
    platform: 'douyin',
    name: String(row.name),
    profileUrl: String(row.profile_url),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at)
  }
}

function mapWork(row: Record<string, unknown>): Work {
  return {
    id: String(row.id),
    creatorId: row.creator_id === null ? null : String(row.creator_id),
    platformWorkId: row.platform_work_id === null ? null : String(row.platform_work_id),
    sourceType: String(row.source_type) as WorkSourceType,
    sourceKey: String(row.source_key),
    mediaPath: row.media_path === null ? null : String(row.media_path),
    title: String(row.title),
    publishedAt: String(row.published_at),
    originalUrl: row.original_url === null ? null : String(row.original_url),
    downloadUrl: row.download_url ? String(row.download_url) : null,
    metrics: {
      likes: Number(row.likes),
      comments: Number(row.comments),
      shares: Number(row.shares),
      collects: Number(row.collects)
    }
  }
}

class CreatorRepository {
  constructor(private readonly database: Database.Database) {}

  create(creator: Creator): Creator {
    this.database
      .prepare(
        `INSERT INTO creators (id, platform, name, profile_url, enabled, created_at)
         VALUES (@id, @platform, @name, @profileUrl, @enabled, @createdAt)`
      )
      .run({ ...creator, enabled: creator.enabled ? 1 : 0 })
    return creator
  }

  list(): Creator[] {
    return this.database
      .prepare('SELECT * FROM creators ORDER BY created_at ASC')
      .all()
      .map((row) => mapCreator(row as Record<string, unknown>))
  }

  getById(id: string): Creator | null {
    const row = this.database.prepare('SELECT * FROM creators WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapCreator(row) : null
  }

  setEnabled(id: string, enabled: boolean): void {
    this.database.prepare('UPDATE creators SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM creators WHERE id = ?').run(id)
  }
}

class WorkRepository {
  constructor(private readonly database: Database.Database) {}

  upsert(work: Work): Work {
    this.database
      .prepare(
        `INSERT INTO works (
          id, creator_id, platform_work_id, source_type, source_key, media_path,
          title, published_at, original_url, download_url,
          likes, comments, shares, collects
        ) VALUES (
          @id, @creatorId, @platformWorkId, @sourceType, @sourceKey, @mediaPath,
          @title, @publishedAt, @originalUrl, @downloadUrl,
          @likes, @comments, @shares, @collects
        )
        ON CONFLICT(source_type, source_key) DO UPDATE SET
          creator_id = excluded.creator_id,
          platform_work_id = excluded.platform_work_id,
          media_path = excluded.media_path,
          title = excluded.title,
          original_url = excluded.original_url,
          download_url = excluded.download_url,
          likes = excluded.likes,
          comments = excluded.comments,
          shares = excluded.shares,
          collects = excluded.collects`
      )
      .run(workToParams(work))

    const row = this.database
      .prepare('SELECT * FROM works WHERE source_type = ? AND source_key = ?')
      .get(work.sourceType, work.sourceKey) as Record<string, unknown>
    return mapWork(row)
  }

  listByCreator(creatorId: string): Work[] {
    return this.database
      .prepare('SELECT * FROM works WHERE creator_id = ? ORDER BY published_at DESC')
      .all(creatorId)
      .map((row) => mapWork(row as Record<string, unknown>))
  }

  listAll(): Work[] {
    return this.database
      .prepare('SELECT * FROM works ORDER BY published_at DESC')
      .all()
      .map((row) => mapWork(row as Record<string, unknown>))
  }

  findBySource(sourceType: WorkSourceType, sourceKey: string): Work | null {
    const row = this.database
      .prepare('SELECT * FROM works WHERE source_type = ? AND source_key = ?')
      .get(sourceType, sourceKey) as Record<string, unknown> | undefined
    return row ? mapWork(row) : null
  }

  get(id: string): Work | null {
    const row = this.database.prepare('SELECT * FROM works WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapWork(row) : null
  }

  setMediaPath(id: string, mediaPath: string): void {
    this.database.prepare('UPDATE works SET media_path = ? WHERE id = ?').run(mediaPath, id)
  }

  finalizeSource(id: string, work: Pick<Work, 'sourceKey' | 'mediaPath' | 'title' | 'originalUrl' | 'downloadUrl'>): void {
    this.database.prepare(
      `UPDATE works SET source_key = @sourceKey, media_path = @mediaPath, title = @title,
       original_url = @originalUrl, download_url = @downloadUrl WHERE id = @id`
    ).run({ id, ...work })
  }
}

function workToParams(work: Work): Record<string, unknown> {
  return { ...work, ...work.metrics }
}

class JobRepository {
  constructor(private readonly database: Database.Database) {}

  save(job: JobRecord): void {
    this.database.prepare(
      `INSERT INTO processing_jobs (
        work_id, stage, status, attempt_count, next_attempt_at, error_code, error_message, updated_at
      ) VALUES (@workId, @stage, @status, @attemptCount, @nextAttemptAt, @errorCode, @errorMessage, @updatedAt)
      ON CONFLICT(work_id) DO UPDATE SET
        stage = excluded.stage, status = excluded.status, attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at, error_code = excluded.error_code,
        error_message = excluded.error_message, updated_at = excluded.updated_at`
    ).run(job)
  }

  get(workId: string): JobRecord | null {
    const row = this.database.prepare('SELECT * FROM processing_jobs WHERE work_id = ?').get(workId) as
      | Record<string, unknown> | undefined
    return row ? mapJob(row) : null
  }

  list(): JobRecord[] {
    return this.database.prepare('SELECT * FROM processing_jobs ORDER BY updated_at DESC').all()
      .map((row) => mapJob(row as Record<string, unknown>))
  }

  saveStage(workId: string, stage: WorkflowStage): void {
    const existing = this.get(workId)
    this.save({
      workId,
      stage,
      status: existing?.status ?? 'pending',
      attemptCount: existing?.attemptCount ?? 0,
      nextAttemptAt: existing?.nextAttemptAt ?? null,
      errorCode: existing?.errorCode ?? null,
      errorMessage: existing?.errorMessage ?? null,
      updatedAt: new Date().toISOString()
    })
  }

  getStage(workId: string): WorkflowStage | null {
    const row = this.database
      .prepare('SELECT stage FROM processing_jobs WHERE work_id = ?')
      .get(workId) as { stage: WorkflowStage } | undefined
    return row?.stage ?? null
  }
}

class JobArtifactRepository {
  constructor(private readonly database: Database.Database) {}

  save(record: JobArtifactRecord): void {
    this.database.prepare(
      `INSERT INTO job_artifacts (work_id, wav_path, transcript, existing_work_id, updated_at)
       VALUES (@workId, @wavPath, @transcript, @existingWorkId, @updatedAt)
       ON CONFLICT(work_id) DO UPDATE SET wav_path = excluded.wav_path,
       transcript = excluded.transcript, existing_work_id = excluded.existing_work_id,
       updated_at = excluded.updated_at`
    ).run(record)
  }

  get(workId: string): JobArtifactRecord | null {
    const row = this.database.prepare('SELECT * FROM job_artifacts WHERE work_id = ?').get(workId) as Record<string, unknown> | undefined
    return row ? {
      workId: String(row.work_id),
      wavPath: row.wav_path === null ? null : String(row.wav_path),
      transcript: row.transcript === null ? null : String(row.transcript),
      existingWorkId: row.existing_work_id === null ? null : String(row.existing_work_id),
      updatedAt: String(row.updated_at)
    } : null
  }

  list(): JobArtifactRecord[] {
    return this.database.prepare('SELECT * FROM job_artifacts').all().map((value) => {
      const row = value as Record<string, unknown>
      return {
        workId: String(row.work_id),
        wavPath: row.wav_path === null ? null : String(row.wav_path),
        transcript: row.transcript === null ? null : String(row.transcript),
        existingWorkId: row.existing_work_id === null ? null : String(row.existing_work_id),
        updatedAt: String(row.updated_at)
      }
    })
  }
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    workId: String(row.work_id), stage: String(row.stage) as WorkflowStage,
    status: String(row.status) as JobRecord['status'], attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at === null ? null : String(row.next_attempt_at),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    updatedAt: String(row.updated_at)
  }
}

export class SettingsRepository {
  constructor(private readonly database: Database.Database) {}

  set(key: string, value: unknown): void {
    this.database
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), new Date().toISOString())
  }

  get<T = unknown>(key: string): T | null {
    const row = this.database.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined
    return row ? (JSON.parse(row.value_json) as T) : null
  }
}

class SnapshotRepository {
  constructor(private readonly database: Database.Database) {}

  create(snapshot: MetricSnapshotRecord): void {
    this.database
      .prepare(
        `INSERT INTO metric_snapshots (
          id, work_id, captured_at, likes, comments, shares, collects
        ) VALUES (@id, @workId, @capturedAt, @likes, @comments, @shares, @collects)`
      )
      .run({ ...snapshot, ...snapshot.metrics })
  }

  listByWork(workId: string): MetricSnapshotRecord[] {
    return this.database
      .prepare('SELECT * FROM metric_snapshots WHERE work_id = ? ORDER BY captured_at ASC')
      .all(workId)
      .map((value) => {
        const row = value as Record<string, unknown>
        return {
          id: String(row.id),
          workId: String(row.work_id),
          capturedAt: String(row.captured_at),
          metrics: {
            likes: Number(row.likes),
            comments: Number(row.comments),
            shares: Number(row.shares),
            collects: Number(row.collects)
          }
        }
      })
  }
}

class AnalysisRepository {
  constructor(private readonly database: Database.Database) {}

  save(analysis: AnalysisRecord): void {
    this.database
      .prepare(
        `INSERT INTO analyses (
          work_id, transcript, result_json, provider, model, prompt_version,
          token_usage_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_id) DO UPDATE SET
          transcript = excluded.transcript,
          result_json = excluded.result_json,
          provider = excluded.provider,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          token_usage_json = excluded.token_usage_json,
          created_at = excluded.created_at`
      )
      .run(
        analysis.workId,
        analysis.transcript,
        JSON.stringify(analysis.result),
        analysis.provider,
        analysis.model,
        analysis.promptVersion,
        analysis.tokenUsage ? JSON.stringify(analysis.tokenUsage) : null,
        analysis.createdAt
      )
  }

  get(workId: string): AnalysisRecord | null {
    const row = this.database.prepare('SELECT * FROM analyses WHERE work_id = ?').get(workId) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return {
      workId: String(row.work_id),
      transcript: String(row.transcript),
      result: JSON.parse(String(row.result_json)) as Record<string, unknown>,
      provider: String(row.provider),
      model: String(row.model),
      promptVersion: String(row.prompt_version),
      tokenUsage: row.token_usage_json
        ? (JSON.parse(String(row.token_usage_json)) as Record<string, number>)
        : null,
      createdAt: String(row.created_at)
    }
  }

  list(): AnalysisRecord[] {
    return this.database.prepare('SELECT * FROM analyses').all().map((value) => {
      const row = value as Record<string, unknown>
      return {
        workId: String(row.work_id), transcript: String(row.transcript),
        result: JSON.parse(String(row.result_json)) as Record<string, unknown>,
        provider: String(row.provider), model: String(row.model), promptVersion: String(row.prompt_version),
        tokenUsage: row.token_usage_json ? JSON.parse(String(row.token_usage_json)) as Record<string, number> : null,
        createdAt: String(row.created_at)
      }
    })
  }
}

class RunRepository {
  constructor(private readonly database: Database.Database) {}

  save(run: RunRecord): void {
    this.database
      .prepare(
        `INSERT INTO runs (id, kind, status, started_at, finished_at, summary_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           finished_at = excluded.finished_at,
           summary_json = excluded.summary_json`
      )
      .run(
        run.id,
        run.kind,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.summary ? JSON.stringify(run.summary) : null
      )
  }

  get(id: string): RunRecord | null {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return {
      id: String(row.id),
      kind: String(row.kind) as RunRecord['kind'],
      status: String(row.status) as RunRecord['status'],
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      summary: row.summary_json
        ? (JSON.parse(String(row.summary_json)) as Record<string, unknown>)
        : null
    }
  }
}

export class AppRepositories {
  readonly creators: CreatorRepository
  readonly works: WorkRepository
  readonly jobs: JobRepository
  readonly settings: SettingsRepository
  readonly snapshots: SnapshotRepository
  readonly analyses: AnalysisRepository
  readonly runs: RunRepository
  readonly artifacts: JobArtifactRepository
  private readonly database: Database.Database

  constructor(database: Database.Database) {
    this.database = database
    this.creators = new CreatorRepository(database)
    this.works = new WorkRepository(database)
    this.jobs = new JobRepository(database)
    this.settings = new SettingsRepository(database)
    this.snapshots = new SnapshotRepository(database)
    this.analyses = new AnalysisRepository(database)
    this.runs = new RunRepository(database)
    this.artifacts = new JobArtifactRepository(database)
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)()
  }
}
