import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../../src/services/database/database'
import { MIGRATIONS } from '../../src/services/database/migrations'
import { AppRepositories } from '../../src/services/database/repositories'

describe('SQLite repositories', () => {
  let database: AppDatabase
  let repositories: AppRepositories

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    repositories = new AppRepositories(database.connection)
  })

  afterEach(() => database.close())

  it('applies the latest schema exactly once', () => {
    expect(database.schemaVersion).toBe(2)
    database.migrate()
    expect(database.schemaVersion).toBe(2)
  })

  it('migrates v1 works without losing related records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    legacy.exec(MIGRATIONS[0])
    legacy.pragma('user_version = 1')
    legacy.prepare(`INSERT INTO creators VALUES (?, ?, ?, ?, ?, ?)`).run(
      'creator-1', 'douyin', 'Creator', 'https://example.com/creator', 1, '2026-07-11T00:00:00.000Z'
    )
    legacy.prepare(`INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'work-1', 'creator-1', '7658', 'Legacy', '2026-07-11T00:00:00.000Z',
      'https://www.douyin.com/video/7658', null, 1, 2, 3, 4
    )
    legacy.prepare(`INSERT INTO metric_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'snapshot-1', 'work-1', '2026-07-11T01:00:00.000Z', 1, 2, 3, 4
    )
    legacy.prepare(`INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'work-1', 'text', '{}', 'provider', 'model', 'v1', null, '2026-07-11T01:00:00.000Z'
    )
    legacy.prepare(`INSERT INTO processing_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'work-1', 'transcribed', 'pending', 0, null, null, null, '2026-07-11T01:00:00.000Z'
    )
    legacy.close()

    const migrated = new AppDatabase(path)
    expect(migrated.schemaVersion).toBe(2)
    expect(new AppRepositories(migrated.connection).works.findBySource('douyin_monitor', 'douyin:7658')?.id)
      .toBe('work-1')
    expect(migrated.connection.prepare('SELECT count(*) AS count FROM metric_snapshots').get()).toEqual({ count: 1 })
    expect(migrated.connection.prepare('SELECT count(*) AS count FROM analyses').get()).toEqual({ count: 1 })
    expect(migrated.connection.prepare('SELECT count(*) AS count FROM processing_jobs').get()).toEqual({ count: 1 })
    expect(migrated.connection.pragma('foreign_key_check')).toEqual([])
    migrated.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('rolls back a v1 migration when foreign key violations exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-invalid-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    legacy.exec(MIGRATIONS[0])
    legacy.pragma('user_version = 1')
    legacy.pragma('foreign_keys = OFF')
    legacy.prepare(`INSERT INTO metric_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'orphan-snapshot', 'missing-work', '2026-07-11T01:00:00.000Z', 1, 2, 3, 4
    )
    legacy.close()

    expect(() => new AppDatabase(path)).toThrow('foreign key check')

    const rolledBack = new Database(path)
    expect(rolledBack.pragma('user_version', { simple: true })).toBe(1)
    const workColumns = rolledBack.pragma('table_info(works)') as Array<{ name: string }>
    expect(workColumns.some((column) => column.name === 'source_type')).toBe(false)
    expect(rolledBack.prepare('SELECT work_id FROM metric_snapshots').all()).toEqual([
      { work_id: 'missing-work' }
    ])
    rolledBack.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('stores creators and prevents duplicate profile URLs', () => {
    const creator = repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })

    expect(repositories.creators.list()).toEqual([creator])
    expect(() => repositories.creators.create({ ...creator, id: 'creator-2' })).toThrow()
  })

  it('deletes a creator and cascades its works', () => {
    repositories.creators.create({
      id: 'creator-delete', platform: 'douyin', name: '待删除博主',
      profileUrl: 'https://www.douyin.com/user/delete', enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-delete', creatorId: 'creator-delete', platformWorkId: 'delete-1',
      title: '待删除作品', publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/delete-1',
      downloadUrl: null, sourceType: 'douyin_monitor', sourceKey: 'douyin:delete-1', mediaPath: null,
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })

    repositories.creators.delete('creator-delete')

    expect(repositories.creators.list()).toEqual([])
    expect(repositories.works.listAll()).toEqual([])
  })

  it('upserts a work without duplicating its platform ID', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })

    const first = repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '初始标题',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: null, sourceType: 'douyin_monitor', sourceKey: 'douyin:7658', mediaPath: null,
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })
    const updated = repositories.works.upsert({ ...first, title: '更新标题' })

    expect(updated.id).toBe('work-1')
    expect(repositories.works.listByCreator('creator-1')).toHaveLength(1)
    expect(repositories.works.listByCreator('creator-1')[0].title).toBe('更新标题')
  })

  it('persists the latest successful workflow stage and settings', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '测试作品',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: null, sourceType: 'douyin_monitor', sourceKey: 'douyin:7658', mediaPath: null,
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })
    repositories.jobs.saveStage('work-1', 'transcribed')
    repositories.settings.set('highlight.minimumBaselineWorks', 5)

    expect(repositories.jobs.getStage('work-1')).toBe('transcribed')
    expect(repositories.settings.get('highlight.minimumBaselineWorks')).toBe(5)
  })

  it('stores an unclassified imported work and finds it by source identity', () => {
    const imported = repositories.works.upsert({
      id: 'import-1', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:abc', mediaPath: 'C:\\videos\\clip.mp4',
      title: 'Imported clip', publishedAt: '2026-07-12T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })

    expect(imported).toEqual(repositories.works.findBySource('local_file', 'sha256:abc'))
    expect(imported.creatorId).toBeNull()
    expect(imported.platformWorkId).toBeNull()
    expect(imported.mediaPath).toBe('C:\\videos\\clip.mp4')
  })

  it('upserts works by source identity', () => {
    const imported = {
      id: 'import-1', creatorId: null, platformWorkId: null,
      sourceType: 'local_file' as const, sourceKey: 'sha256:abc', mediaPath: 'first.mp4',
      title: 'First', publishedAt: '2026-07-12T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    repositories.works.upsert(imported)
    const updated = repositories.works.upsert({ ...imported, id: 'import-2', title: 'Updated' })

    expect(updated.id).toBe('import-1')
    expect(updated.title).toBe('Updated')
    expect(repositories.works.listAll()).toHaveLength(1)
  })

  it('saves, gets and lists complete processing job state', () => {
    repositories.works.upsert({
      id: 'import-1', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:abc', mediaPath: 'clip.mp4',
      title: 'Imported', publishedAt: '2026-07-12T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const job = {
      workId: 'import-1', stage: 'transcribed' as const, status: 'failed' as const,
      attemptCount: 2, nextAttemptAt: '2026-07-12T01:00:00.000Z',
      errorCode: 'TRANSCRIPTION_FAILED', errorMessage: 'temporary failure',
      updatedAt: '2026-07-12T00:30:00.000Z'
    }
    repositories.jobs.save(job)

    expect(repositories.jobs.get('import-1')).toEqual(job)
    expect(repositories.jobs.list()).toEqual([job])
    repositories.jobs.saveStage('import-1', 'analyzed')
    expect(repositories.jobs.getStage('import-1')).toBe('analyzed')
    expect(repositories.jobs.get('import-1')?.attemptCount).toBe(2)
  })

  it('stores metric snapshots, analyses and run summaries', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '测试作品',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: null, sourceType: 'douyin_monitor', sourceKey: 'douyin:7658', mediaPath: null,
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })

    repositories.snapshots.create({
      id: 'snapshot-1',
      workId: 'work-1',
      capturedAt: '2026-07-11T09:00:00.000Z',
      metrics: { likes: 20, comments: 3, shares: 2, collects: 4 }
    })
    repositories.analyses.save({
      workId: 'work-1',
      transcript: '完整文案',
      result: { referenceValueScore: 85 },
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptVersion: 'v1',
      tokenUsage: { input: 100, output: 50 },
      createdAt: '2026-07-11T09:05:00.000Z'
    })
    repositories.runs.save({
      id: 'run-1',
      kind: 'daily',
      status: 'completed',
      startedAt: '2026-07-11T09:00:00.000Z',
      finishedAt: '2026-07-11T09:10:00.000Z',
      summary: { discovered: 1, analyzed: 1 }
    })

    expect(repositories.snapshots.listByWork('work-1')).toHaveLength(1)
    expect(repositories.analyses.get('work-1')?.provider).toBe('deepseek')
    expect(repositories.runs.get('run-1')?.summary).toEqual({ discovered: 1, analyzed: 1 })
  })
})
