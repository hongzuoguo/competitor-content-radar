import type Database from 'better-sqlite3'
import type { Creator, Work } from '../../core/domain'
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
    creatorId: String(row.creator_id),
    platformWorkId: String(row.platform_work_id),
    title: String(row.title),
    publishedAt: String(row.published_at),
    originalUrl: String(row.original_url),
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
}

class WorkRepository {
  constructor(private readonly database: Database.Database) {}

  upsert(work: Work): Work {
    this.database
      .prepare(
        `INSERT INTO works (
          id, creator_id, platform_work_id, title, published_at, original_url,
          likes, comments, shares, collects
        ) VALUES (
          @id, @creatorId, @platformWorkId, @title, @publishedAt, @originalUrl,
          @likes, @comments, @shares, @collects
        )
        ON CONFLICT(platform_work_id) DO UPDATE SET
          title = excluded.title,
          original_url = excluded.original_url,
          likes = excluded.likes,
          comments = excluded.comments,
          shares = excluded.shares,
          collects = excluded.collects`
      )
      .run({ ...work, ...work.metrics })

    const row = this.database
      .prepare('SELECT * FROM works WHERE platform_work_id = ?')
      .get(work.platformWorkId) as Record<string, unknown>
    return mapWork(row)
  }

  listByCreator(creatorId: string): Work[] {
    return this.database
      .prepare('SELECT * FROM works WHERE creator_id = ? ORDER BY published_at DESC')
      .all(creatorId)
      .map((row) => mapWork(row as Record<string, unknown>))
  }
}

class JobRepository {
  constructor(private readonly database: Database.Database) {}

  saveStage(workId: string, stage: WorkflowStage): void {
    this.database
      .prepare(
        `INSERT INTO processing_jobs (work_id, stage, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(work_id) DO UPDATE SET
           stage = excluded.stage,
           updated_at = excluded.updated_at`
      )
      .run(workId, stage, new Date().toISOString())
  }

  getStage(workId: string): WorkflowStage | null {
    const row = this.database
      .prepare('SELECT stage FROM processing_jobs WHERE work_id = ?')
      .get(workId) as { stage: WorkflowStage } | undefined
    return row?.stage ?? null
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

  constructor(database: Database.Database) {
    this.creators = new CreatorRepository(database)
    this.works = new WorkRepository(database)
    this.jobs = new JobRepository(database)
    this.settings = new SettingsRepository(database)
    this.snapshots = new SnapshotRepository(database)
    this.analyses = new AnalysisRepository(database)
    this.runs = new RunRepository(database)
  }
}
