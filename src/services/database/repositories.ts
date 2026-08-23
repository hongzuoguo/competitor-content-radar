import type Database from 'better-sqlite3'
import type { Creator, Work, WorkOwnership, WorkSourceType } from '../../core/domain'
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
  kind: 'daily' | 'manual' | 'catch_up'
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

export interface FeishuBindingRecord {
  appToken: string
  baseName: string
  baseUrl: string
  schemaVersion: number
  status: string
  lastSyncedAt: string | null
  errorMessage: string | null
}

export interface FeishuFieldBindingRecord {
  tableKey: string
  fieldKey: string
  fieldId: string
  fieldName: string
  fieldType: string
}

export interface FeishuRecordMappingRecord {
  tableKey: string
  localId: string
  recordId: string
  firstSyncedAt?: string | null
}

export interface FeishuRecordMappingView {
  recordId: string
  firstSyncedAt: string | null
}

export interface ModelProfileRecord {
  id: string
  name: string
  providerTemplate: string
  baseUrl: string
  modelId: string
  requiresApiKey: boolean
  enabled: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentAuditRecord {
  id: string
  capability: string
  source: 'local-api' | 'mcp'
  success: boolean
  errorCode: string | null
  durationMs: number
  createdAt: string
}

function mapCreator(row: Record<string, unknown>): Creator {
  return {
    id: String(row.id),
    platform: 'douyin',
    name: String(row.name),
    profileUrl: String(row.profile_url),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    ownership: String(row.ownership ?? 'competitor') as WorkOwnership
  }
}

function mapWork(row: Record<string, unknown>): Work {
  return {
    id: String(row.id),
    creatorId: row.creator_id === null ? null : String(row.creator_id),
    platformWorkId: row.platform_work_id === null ? null : String(row.platform_work_id),
    sourceType: String(row.source_type) as WorkSourceType,
    ownership: String(row.ownership ?? 'competitor') as WorkOwnership,
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

function mapModelProfile(row: Record<string, unknown>): ModelProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    providerTemplate: String(row.provider_template),
    baseUrl: String(row.base_url),
    modelId: String(row.model_id),
    requiresApiKey: Boolean(row.requires_api_key),
    enabled: Boolean(row.enabled),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

class CreatorRepository {
  constructor(private readonly database: Database.Database) {}

  create(creator: Creator): Creator {
    this.database
      .prepare(
        `INSERT INTO creators (id, platform, name, profile_url, enabled, created_at, ownership)
         VALUES (@id, @platform, @name, @profileUrl, @enabled, @createdAt, @ownership)`
      )
      .run({ ...creator, enabled: creator.enabled ? 1 : 0, ownership: creator.ownership ?? 'competitor' })
    return { ...creator, ownership: creator.ownership ?? 'competitor' }
  }

  upsert(creator: Creator): Creator {
    this.database.prepare(
      `INSERT INTO creators (id, platform, name, profile_url, enabled, created_at, ownership)
       VALUES (@id, @platform, @name, @profileUrl, @enabled, @createdAt, @ownership)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, profile_url = excluded.profile_url, ownership = excluded.ownership`
    ).run({ ...creator, enabled: creator.enabled ? 1 : 0, ownership: creator.ownership ?? 'competitor' })
    return { ...creator, ownership: creator.ownership ?? 'competitor' }
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

  setOwnership(id: string, ownership: WorkOwnership): void {
    this.database.prepare('UPDATE creators SET ownership = ? WHERE id = ?').run(ownership, id)
  }

  updateMetadata(id: string, name: string, profileUrl: string): void {
    this.database.prepare(
      'UPDATE creators SET name = ?, profile_url = ? WHERE id = ?'
    ).run(name, profileUrl, id)
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
          id, creator_id, platform_work_id, source_type, source_key, media_path, ownership,
          title, published_at, original_url, download_url,
          likes, comments, shares, collects
        ) VALUES (
          @id, @creatorId, @platformWorkId, @sourceType, @sourceKey, @mediaPath, @ownership,
          @title, @publishedAt, @originalUrl, @downloadUrl,
          @likes, @comments, @shares, @collects
        )
        ON CONFLICT(source_type, source_key) DO UPDATE SET
          creator_id = excluded.creator_id,
          platform_work_id = excluded.platform_work_id,
          media_path = excluded.media_path,
          ownership = excluded.ownership,
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

  delete(id: string): void {
    this.database.prepare('DELETE FROM works WHERE id = ?').run(id)
  }

  deleteUnclassified(): string[] {
    const ids = this.database.prepare(
      'SELECT id FROM works WHERE creator_id IS NULL'
    ).all().map((row) => String((row as { id: unknown }).id))
    this.database.prepare('DELETE FROM works WHERE creator_id IS NULL').run()
    return ids
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
  return {
    ...work,
    ownership: work.ownership ?? (work.sourceType === 'douyin_monitor' ? 'competitor' : 'mine'),
    ...work.metrics
  }
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

  delete(key: string): void {
    this.database.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}

export class AgentAuditRepository {
  constructor(private readonly database: Database.Database) {}

  create(record: AgentAuditRecord): void {
    this.database.prepare(`
      INSERT INTO agent_audit_logs (
        id, capability, source, success, error_code, duration_ms, created_at
      ) VALUES (@id, @capability, @source, @success, @errorCode, @durationMs, @createdAt)
    `).run({ ...record, success: record.success ? 1 : 0 })
  }

  listRecent(limit = 50): AgentAuditRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    return (this.database.prepare('SELECT * FROM agent_audit_logs ORDER BY created_at DESC LIMIT ?').all(safeLimit) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id),
        capability: String(row.capability),
        source: String(row.source) as AgentAuditRecord['source'],
        success: Boolean(row.success),
        errorCode: row.error_code === null ? null : String(row.error_code),
        durationMs: Number(row.duration_ms),
        createdAt: String(row.created_at)
      }))
  }
}

class SnapshotRepository {
  constructor(private readonly database: Database.Database) {}

  create(snapshot: MetricSnapshotRecord): void {
    this.database
      .prepare(
        `INSERT INTO metric_snapshots (
          id, work_id, captured_at, likes, comments, shares, collects
        ) VALUES (@id, @workId, @capturedAt, @likes, @comments, @shares, @collects)
        ON CONFLICT(id) DO UPDATE SET
          captured_at = excluded.captured_at,
          likes = excluded.likes,
          comments = excluded.comments,
          shares = excluded.shares,
          collects = excluded.collects`
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

  list(): MetricSnapshotRecord[] {
    return [...this.listAllByWork().values()].flat()
  }

  listFirstCapturedAt(): Map<string, string> {
    const rows = this.database.prepare(`
      SELECT work_id, MIN(captured_at) AS first_captured_at
      FROM metric_snapshots
      GROUP BY work_id
    `).all() as Array<{ work_id: string; first_captured_at: string }>
    return new Map(rows.map((row) => [String(row.work_id), String(row.first_captured_at)]))
  }

  listAllByWork(): Map<string, MetricSnapshotRecord[]> {
    const rows = this.database.prepare('SELECT * FROM metric_snapshots ORDER BY captured_at ASC').all() as Array<Record<string, unknown>>
    const byWork = new Map<string, MetricSnapshotRecord[]>()
    for (const row of rows) {
      const workId = String(row.work_id)
      const group = byWork.get(workId) ?? []
      group.push({
        id: String(row.id),
        workId,
        capturedAt: String(row.captured_at),
        metrics: {
          likes: Number(row.likes),
          comments: Number(row.comments),
          shares: Number(row.shares),
          collects: Number(row.collects)
        }
      })
      byWork.set(workId, group)
    }
    return byWork
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

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM runs WHERE id = ?').run(id).changes > 0
  }

  list(limit = 50): RunRecord[] {
    return this.database.prepare(
      'SELECT * FROM runs ORDER BY started_at DESC LIMIT ?'
    ).all(limit).map((value) => {
      const row = value as Record<string, unknown>
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
    })
  }

  listRunning(): RunRecord[] {
    return this.database.prepare(
      "SELECT * FROM runs WHERE status = 'running' ORDER BY started_at ASC"
    ).all().map((value) => {
      const row = value as Record<string, unknown>
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
    })
  }

  latestCompletedDaily(): RunRecord | null {
    const row = this.database.prepare(
      `SELECT * FROM runs
       WHERE kind IN ('daily', 'catch_up')
         AND status IN ('completed', 'partial')
         AND finished_at IS NOT NULL
       ORDER BY finished_at DESC
       LIMIT 1`
    ).get() as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id),
      kind: String(row.kind) as RunRecord['kind'],
      status: String(row.status) as RunRecord['status'],
      startedAt: String(row.started_at),
      finishedAt: String(row.finished_at),
      summary: row.summary_json
        ? (JSON.parse(String(row.summary_json)) as Record<string, unknown>)
        : null
    }
  }

  latestFinished(): RunRecord | null {
    const row = this.database.prepare(
      `SELECT * FROM runs
       WHERE status IN ('completed', 'partial')
         AND finished_at IS NOT NULL
       ORDER BY finished_at DESC
       LIMIT 1`
    ).get() as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id),
      kind: String(row.kind) as RunRecord['kind'],
      status: String(row.status) as RunRecord['status'],
      startedAt: String(row.started_at),
      finishedAt: String(row.finished_at),
      summary: row.summary_json
        ? (JSON.parse(String(row.summary_json)) as Record<string, unknown>)
        : null
    }
  }
}

class FeishuRepository {
  constructor(private readonly database: Database.Database) {}

  saveBinding(binding: FeishuBindingRecord): void {
    this.database.prepare(
      `INSERT INTO feishu_bindings (
        id, app_token, base_name, base_url, schema_version, status, last_synced_at, error_message
      ) VALUES (
        'default', @appToken, @baseName, @baseUrl, @schemaVersion, @status, @lastSyncedAt, @errorMessage
      )
      ON CONFLICT(id) DO UPDATE SET
        app_token = excluded.app_token,
        base_name = excluded.base_name,
        base_url = excluded.base_url,
        schema_version = excluded.schema_version,
        status = excluded.status,
        last_synced_at = excluded.last_synced_at,
        error_message = excluded.error_message`
    ).run(binding)
  }

  getBinding(): FeishuBindingRecord | null {
    const row = this.database.prepare("SELECT * FROM feishu_bindings WHERE id = 'default'").get() as
      | Record<string, unknown>
      | undefined
    return row ? {
      appToken: String(row.app_token),
      baseName: String(row.base_name),
      baseUrl: String(row.base_url),
      schemaVersion: Number(row.schema_version),
      status: String(row.status),
      lastSyncedAt: row.last_synced_at === null ? null : String(row.last_synced_at),
      errorMessage: row.error_message === null ? null : String(row.error_message)
    } : null
  }

  clear(): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM feishu_record_mappings').run()
      this.database.prepare('DELETE FROM feishu_field_bindings').run()
      this.database.prepare('DELETE FROM feishu_table_bindings').run()
      this.database.prepare('DELETE FROM feishu_bindings').run()
    })()
  }

  saveTable(table: { tableKey: string; tableId: string }): void {
    this.database.prepare(
      `INSERT INTO feishu_table_bindings (table_key, table_id) VALUES (@tableKey, @tableId)
       ON CONFLICT(table_key) DO UPDATE SET table_id = excluded.table_id`
    ).run(table)
  }

  getTables(): Record<string, string> {
    const rows = this.database.prepare('SELECT table_key, table_id FROM feishu_table_bindings').all() as
      Array<{ table_key: string; table_id: string }>
    return Object.fromEntries(rows.map((row) => [row.table_key, row.table_id]))
  }

  saveField(field: FeishuFieldBindingRecord): void {
    this.database.prepare(
      `INSERT INTO feishu_field_bindings (table_key, field_key, field_id, field_name, field_type)
       VALUES (@tableKey, @fieldKey, @fieldId, @fieldName, @fieldType)
       ON CONFLICT(table_key, field_key) DO UPDATE SET
         field_id = excluded.field_id, field_name = excluded.field_name, field_type = excluded.field_type`
    ).run(field)
  }

  getFields(tableKey: string): FeishuFieldBindingRecord[] {
    return this.database.prepare(
      'SELECT * FROM feishu_field_bindings WHERE table_key = ? ORDER BY field_key'
    ).all(tableKey).map((value) => {
      const row = value as Record<string, unknown>
      return {
        tableKey: String(row.table_key),
        fieldKey: String(row.field_key),
        fieldId: String(row.field_id),
        fieldName: String(row.field_name),
        fieldType: String(row.field_type)
      }
    })
  }

  saveRecordMapping(mapping: FeishuRecordMappingRecord): void {
    this.database.prepare(
      `INSERT INTO feishu_record_mappings (table_key, local_id, record_id, first_synced_at)
       VALUES (@tableKey, @localId, @recordId, @firstSyncedAt)
       ON CONFLICT(table_key, local_id) DO UPDATE SET
         record_id = excluded.record_id,
         first_synced_at = COALESCE(feishu_record_mappings.first_synced_at, excluded.first_synced_at)`
    ).run({ ...mapping, firstSyncedAt: mapping.firstSyncedAt ?? null })
  }

  removeTableNamespace(tableKey: string): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM feishu_record_mappings WHERE table_key = ?').run(tableKey)
      this.database.prepare('DELETE FROM feishu_field_bindings WHERE table_key = ?').run(tableKey)
      this.database.prepare('DELETE FROM feishu_table_bindings WHERE table_key = ?').run(tableKey)
    })()
  }

  getRecordMapping(tableKey: string, localId: string): string | null {
    const row = this.database.prepare(
      'SELECT record_id FROM feishu_record_mappings WHERE table_key = ? AND local_id = ?'
    ).get(tableKey, localId) as { record_id: string } | undefined
    return row?.record_id ?? null
  }

  getRecordMappingRecord(tableKey: string, localId: string): FeishuRecordMappingView | null {
    const row = this.database.prepare(
      'SELECT record_id, first_synced_at FROM feishu_record_mappings WHERE table_key = ? AND local_id = ?'
    ).get(tableKey, localId) as { record_id: string; first_synced_at: string | null } | undefined
    return row ? { recordId: row.record_id, firstSyncedAt: row.first_synced_at } : null
  }

  listRecordMappings(tableKey: string): FeishuRecordMappingRecord[] {
    return this.database.prepare(
      'SELECT table_key, local_id, record_id, first_synced_at FROM feishu_record_mappings WHERE table_key = ? ORDER BY local_id'
    ).all(tableKey).map((value) => {
      const row = value as Record<string, unknown>
      return {
        tableKey: String(row.table_key),
        localId: String(row.local_id),
        recordId: String(row.record_id),
        firstSyncedAt: row.first_synced_at === null ? null : String(row.first_synced_at)
      }
    })
  }

  deleteRecordMapping(tableKey: string, localId: string): void {
    this.database.prepare(
      'DELETE FROM feishu_record_mappings WHERE table_key = ? AND local_id = ?'
    ).run(tableKey, localId)
  }
}

export class ModelProfileRepository {
  constructor(private readonly database: Database.Database) {}

  save(profile: ModelProfileRecord): void {
    if (profile.active && !profile.enabled) throw new Error('MODEL_PROFILE_DISABLED')

    const statement = this.database.prepare(
      `INSERT INTO model_profiles (
         id, name, provider_template, base_url, model_id, requires_api_key, enabled, active, created_at, updated_at
       ) VALUES (
         @id, @name, @providerTemplate, @baseUrl, @modelId, @requiresApiKey, @enabled, @active, @createdAt, @updatedAt
       ) ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         provider_template = excluded.provider_template,
         base_url = excluded.base_url,
         model_id = excluded.model_id,
         requires_api_key = excluded.requires_api_key,
         enabled = excluded.enabled,
         active = excluded.active,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    )
    const values = {
      ...profile,
      requiresApiKey: profile.requiresApiKey ? 1 : 0,
      enabled: profile.enabled ? 1 : 0,
      active: profile.active ? 1 : 0
    }

    if (profile.active) {
      this.database.transaction(() => {
        this.database.prepare('UPDATE model_profiles SET active = 0 WHERE active = 1').run()
        statement.run(values)
      })()
      return
    }

    statement.run(values)
  }

  get(id: string): ModelProfileRecord | null {
    const row = this.database.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapModelProfile(row) : null
  }

  list(): ModelProfileRecord[] {
    return this.database.prepare('SELECT * FROM model_profiles ORDER BY created_at, id')
      .all()
      .map((row) => mapModelProfile(row as Record<string, unknown>))
  }

  getActive(): ModelProfileRecord | null {
    const row = this.database.prepare('SELECT * FROM model_profiles WHERE active = 1').get() as Record<string, unknown> | undefined
    return row ? mapModelProfile(row) : null
  }

  activate(id: string): void {
    this.database.transaction(() => {
      const profile = this.database.prepare('SELECT enabled FROM model_profiles WHERE id = ?').get(id) as { enabled: number } | undefined
      if (!profile) throw new Error('MODEL_PROFILE_NOT_FOUND')
      if (!profile.enabled) throw new Error('MODEL_PROFILE_DISABLED')

      this.database.prepare('UPDATE model_profiles SET active = 0 WHERE active = 1').run()
      this.database.prepare('UPDATE model_profiles SET active = 1 WHERE id = ?').run(id)
    })()
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM model_profiles WHERE id = ?').run(id)
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
  readonly feishu: FeishuRepository
  readonly modelProfiles: ModelProfileRepository
  readonly agentAudits: AgentAuditRepository
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
    this.feishu = new FeishuRepository(database)
    this.modelProfiles = new ModelProfileRepository(database)
    this.agentAudits = new AgentAuditRepository(database)
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)()
  }
}
