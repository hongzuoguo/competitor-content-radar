import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
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
    expect(database.schemaVersion).toBe(10)
    database.migrate()
    expect(database.schemaVersion).toBe(10)
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get())
      .toBeUndefined()
  })

  it('keeps exactly one active model profile when activating another profile', () => {
    repositories.modelProfiles.save({
      id: 'profile-a',
      name: 'DeepSeek Flash',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-chat',
      requiresApiKey: true,
      enabled: true,
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    })
    repositories.modelProfiles.save({
      id: 'profile-b',
      name: 'Local model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen3',
      requiresApiKey: false,
      enabled: true,
      active: false,
      createdAt: '2026-08-01T00:00:01.000Z',
      updatedAt: '2026-08-01T00:00:01.000Z'
    })

    repositories.modelProfiles.activate('profile-b')

    expect(repositories.modelProfiles.get('profile-a')?.name).toBe('DeepSeek Flash')
    expect(repositories.modelProfiles.getActive()?.id).toBe('profile-b')
    expect(repositories.modelProfiles.list().filter((profile) => profile.active)).toHaveLength(1)
  })

  it('does not activate a disabled model profile', () => {
    repositories.modelProfiles.save({
      id: 'profile-disabled',
      name: 'Disabled model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'disabled',
      requiresApiKey: true,
      enabled: false,
      active: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(() => repositories.modelProfiles.activate('profile-disabled')).toThrow('MODEL_PROFILE_DISABLED')
    expect(() => repositories.modelProfiles.activate('missing-profile')).toThrow('MODEL_PROFILE_NOT_FOUND')
  })

  it('does not save a disabled model profile as active', () => {
    expect(() => repositories.modelProfiles.save({
      id: 'profile-disabled-active',
      name: 'Disabled active model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'disabled-active',
      requiresApiKey: true,
      enabled: false,
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    })).toThrow('MODEL_PROFILE_DISABLED')

    expect(repositories.modelProfiles.getActive()).toBeNull()
  })

  it('keeps the existing active model profile when a disabled profile is saved as active', () => {
    repositories.modelProfiles.save({
      id: 'profile-a',
      name: 'Active model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'active',
      requiresApiKey: true,
      enabled: true,
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    })
    repositories.modelProfiles.save({
      id: 'profile-b',
      name: 'Disabled model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'disabled',
      requiresApiKey: true,
      enabled: false,
      active: false,
      createdAt: '2026-08-01T00:00:01.000Z',
      updatedAt: '2026-08-01T00:00:01.000Z'
    })

    expect(() => repositories.modelProfiles.save({
      id: 'profile-b',
      name: 'Disabled model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'disabled',
      requiresApiKey: true,
      enabled: false,
      active: true,
      createdAt: '2026-08-01T00:00:01.000Z',
      updatedAt: '2026-08-01T00:00:02.000Z'
    })).toThrow('MODEL_PROFILE_DISABLED')

    expect(repositories.modelProfiles.getActive()?.id).toBe('profile-a')
  })

  it('has no active model profile after deleting the active profile', () => {
    repositories.modelProfiles.save({
      id: 'profile-active',
      name: 'Active model',
      providerTemplate: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId: 'active',
      requiresApiKey: true,
      enabled: true,
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    })

    repositories.modelProfiles.delete('profile-active')

    expect(repositories.modelProfiles.getActive()).toBeNull()
  })

  it('stores work ownership and Feishu mappings without a report repository', () => {
    const work = repositories.works.upsert({
      id: 'mine-1', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:mine', mediaPath: 'mine.mp4',
      ownership: 'mine', title: 'My work', publishedAt: '2026-07-21T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    expect(work.ownership).toBe('mine')

    repositories.feishu.saveBinding({
      appToken: 'app-token',
      baseName: '对标内容雷达',
      baseUrl: 'https://example.feishu.cn/base/app-token',
      schemaVersion: 1,
      status: 'connected',
      lastSyncedAt: null,
      errorMessage: null
    })
    repositories.feishu.saveTable({ tableKey: 'works', tableId: 'tbl-works' })
    repositories.feishu.saveRecordMapping({
      tableKey: 'works',
      localId: 'mine-1',
      recordId: 'rec-mine-1'
    })

    expect(repositories.feishu.getBinding()?.appToken).toBe('app-token')
    expect(repositories.feishu.getTables()).toEqual({ works: 'tbl-works' })
    expect(repositories.feishu.getRecordMapping('works', 'mine-1')).toBe('rec-mine-1')
  })

  it('removes legacy weekly reports and weekly run history during migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-report-removal-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    for (const migration of MIGRATIONS.slice(0, 8)) legacy.exec(migration)
    legacy.pragma('user_version = 8')
    legacy.prepare(`INSERT INTO reports (
      id, type, period, collected_works, viral_works, warming_works,
      likes_gained, topic_summary, generated_at
    ) VALUES (?, 'weekly', ?, 1, 1, 0, 10, '', ?)`)
      .run('weekly:2026-08-03', '2026-08-03/2026-08-09', '2026-08-07T00:00:00.000Z')
    legacy.prepare(`INSERT INTO runs (id, kind, status, started_at, finished_at, summary_json)
      VALUES (?, 'weekly', 'completed', ?, ?, '{}')`)
      .run('weekly-run', '2026-08-07T00:00:00.000Z', '2026-08-07T00:01:00.000Z')
    legacy.close()

    const migrated = new AppDatabase(path)

    expect(migrated.schemaVersion).toBe(10)
    expect(migrated.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get())
      .toBeUndefined()
    expect(migrated.connection.prepare("SELECT id FROM runs WHERE kind = 'weekly'").all()).toEqual([])
    migrated.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('finishes migration when creator ownership already exists in a v8 database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-ownership-repair-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    for (const migration of MIGRATIONS.slice(0, 8)) legacy.exec(migration)
    legacy.exec("ALTER TABLE creators ADD COLUMN ownership TEXT NOT NULL DEFAULT 'competitor'")
    legacy.pragma('user_version = 8')
    legacy.close()

    const migrated = new AppDatabase(path)
    const ownershipColumns = (migrated.connection.pragma('table_info(creators)') as Array<{ name: string }>)
      .filter((column) => column.name === 'ownership')

    expect(migrated.schemaVersion).toBe(10)
    expect(ownershipColumns).toHaveLength(1)
    migrated.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('preserves the first Feishu sync time when a record mapping is updated', () => {
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'record-1',
      firstSyncedAt: '2026-08-01T00:00:00.000Z'
    })
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'record-2',
      firstSyncedAt: '2026-08-07T00:00:00.000Z'
    })

    expect(repositories.feishu.getRecordMappingRecord('works', 'work-1')).toEqual({
      recordId: 'record-2',
      firstSyncedAt: '2026-08-01T00:00:00.000Z'
    })
  })

  it('adds a nullable first sync time to legacy Feishu mappings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-feishu-mapping-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    for (const migration of MIGRATIONS.slice(0, 7)) legacy.exec(migration)
    legacy.pragma('user_version = 7')
    legacy.prepare('INSERT INTO feishu_record_mappings (table_key, local_id, record_id) VALUES (?, ?, ?)')
      .run('works', 'work-1', 'record-1')
    legacy.close()

    const migrated = new AppDatabase(path)
    const mapping = migrated.connection.prepare(
      'SELECT record_id, first_synced_at FROM feishu_record_mappings WHERE table_key = ? AND local_id = ?'
    ).get('works', 'work-1')

    expect(migrated.schemaVersion).toBe(10)
    expect(mapping).toEqual({ record_id: 'record-1', first_synced_at: null })
    migrated.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('repairs a current-version database that is missing the first sync time column', () => {
    const directory = mkdtempSync(join(tmpdir(), 'content-radar-feishu-column-repair-'))
    const path = join(directory, 'radar.sqlite')
    const legacy = new Database(path)
    for (const migration of MIGRATIONS.slice(0, 7)) legacy.exec(migration)
    legacy.pragma(`user_version = ${MIGRATIONS.length}`)
    legacy.prepare('INSERT INTO feishu_record_mappings (table_key, local_id, record_id) VALUES (?, ?, ?)')
      .run('works', 'work-1', 'record-1')
    legacy.close()

    const repaired = new AppDatabase(path)
    const columns = repaired.connection.pragma('table_info(feishu_record_mappings)') as Array<{ name: string }>
    const mapping = repaired.connection.prepare(
      'SELECT record_id, first_synced_at FROM feishu_record_mappings WHERE table_key = ? AND local_id = ?'
    ).get('works', 'work-1')

    expect(repaired.schemaVersion).toBe(MIGRATIONS.length)
    expect(columns.some((column) => column.name === 'first_synced_at')).toBe(true)
    expect(mapping).toEqual({ record_id: 'record-1', first_synced_at: null })
    repaired.close()
    expect(readdirSync(directory).some((file) => file.startsWith('radar.sqlite.backup-'))).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  })

  it('rolls back artifact and stage writes together when the transaction fails', () => {
    repositories.works.upsert({
      id: 'atomic-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'pending:atomic-work', mediaPath: 'video.mp4', title: 'atomic',
      publishedAt: '2026-07-13T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'atomic-work', stage: 'downloaded', status: 'running', attemptCount: 1,
      nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: '2026-07-13T00:00:00.000Z'
    })

    expect(() => repositories.transaction(() => {
      repositories.artifacts.save({
        workId: 'atomic-work', wavPath: 'audio.wav', transcript: null,
        existingWorkId: null, updatedAt: '2026-07-13T00:00:01.000Z'
      })
      repositories.jobs.saveStage('atomic-work', 'audio_extracted')
      throw new Error('SECOND_WRITE_FAILED')
    })).toThrow('SECOND_WRITE_FAILED')

    expect(repositories.artifacts.get('atomic-work')).toBeNull()
    expect(repositories.jobs.get('atomic-work')?.stage).toBe('downloaded')
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
    expect(migrated.schemaVersion).toBe(10)
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

  it('updates creator metadata without changing monitoring state or creation time', () => {
    const creator = repositories.creators.create({
      id: 'creator-metadata',
      platform: 'douyin',
      name: '@MS4wLjABAAAA',
      profileUrl: 'https://www.douyin.com/user/old-profile',
      enabled: false,
      createdAt: '2026-07-11T09:00:00.000Z'
    })

    repositories.creators.updateMetadata(
      creator.id,
      '林克AI实战录',
      'https://www.douyin.com/user/resolved-profile'
    )

    expect(repositories.creators.getById(creator.id)).toEqual({
      ...creator,
      name: '林克AI实战录',
      profileUrl: 'https://www.douyin.com/user/resolved-profile'
    })
  })

  it('stores whether a creator is my own account', () => {
    repositories.creators.create({
      id: 'creator-mine',
      platform: 'douyin',
      name: '我的账号',
      profileUrl: 'https://www.douyin.com/user/mine',
      enabled: true,
      createdAt: '2026-08-08T00:00:00.000Z',
      ownership: 'mine'
    })

    expect(repositories.creators.getById('creator-mine')).toMatchObject({ ownership: 'mine' })
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

  it('deletes a work and cascades its job, artifact, analysis and snapshots', () => {
    repositories.works.upsert({
      id: 'failed-work', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:failed', mediaPath: 'managed/failed-work/video.mp4',
      title: 'Failed', publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-work', stage: 'transcribed', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'AI_FAILED', errorMessage: 'failed', updatedAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.artifacts.save({
      workId: 'failed-work', wavPath: 'managed/failed-work/audio.wav', transcript: 'words',
      existingWorkId: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.analyses.save({
      workId: 'failed-work', transcript: 'words', result: {}, provider: 'test', model: 'test',
      promptVersion: 'v1', tokenUsage: null, createdAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.snapshots.create({
      id: 'failed-snapshot', workId: 'failed-work', capturedAt: '2026-07-12T00:00:00.000Z',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })

    repositories.works.delete('failed-work')

    expect(repositories.works.get('failed-work')).toBeNull()
    expect(repositories.jobs.get('failed-work')).toBeNull()
    expect(repositories.artifacts.get('failed-work')).toBeNull()
    expect(repositories.analyses.get('failed-work')).toBeNull()
    expect(repositories.snapshots.listByWork('failed-work')).toEqual([])
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

  it('updates a deterministic daily snapshot instead of duplicating it', () => {
    repositories.works.upsert({
      id: 'daily-work', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:daily', mediaPath: 'daily.mp4',
      ownership: 'mine', title: 'Daily', publishedAt: '2026-07-25T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })
    repositories.snapshots.create({
      id: 'daily-work:2026-07-25', workId: 'daily-work',
      capturedAt: '2026-07-25T01:00:00.000Z',
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })
    repositories.snapshots.create({
      id: 'daily-work:2026-07-25', workId: 'daily-work',
      capturedAt: '2026-07-25T08:00:00.000Z',
      metrics: { likes: 8, comments: 1, shares: 0, collects: 0 }
    })

    expect(repositories.snapshots.listByWork('daily-work')).toEqual([
      expect.objectContaining({
        id: 'daily-work:2026-07-25',
        capturedAt: '2026-07-25T08:00:00.000Z',
        metrics: expect.objectContaining({ likes: 8 })
      })
    ])
  })

  it('returns the latest finished daily or partial catch-up run', () => {
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'older-daily', kind: 'daily', status: 'completed',
      startedAt: '2026-07-10T00:00:00.000Z', finishedAt: '2026-07-10T00:10:00.000Z', summary: null
    })
    repositories.runs.save({
      id: 'newer-partial', kind: 'catch_up', status: 'partial',
      startedAt: '2026-07-11T00:00:00.000Z', finishedAt: '2026-07-11T00:10:00.000Z', summary: null
    })
    repositories.runs.save({
      id: 'manual', kind: 'manual', status: 'completed',
      startedAt: '2026-07-12T00:00:00.000Z', finishedAt: '2026-07-12T00:10:00.000Z', summary: null
    })
    repositories.runs.save({
      id: 'running', kind: 'daily', status: 'running',
      startedAt: '2026-07-13T00:00:00.000Z', finishedAt: null, summary: null
    })

    expect(repositories.runs.latestCompletedDaily()).toMatchObject({
      id: 'newer-partial', status: 'partial', finishedAt: '2026-07-11T00:10:00.000Z'
    })
    expect(repositories.runs.latestFinished()).toMatchObject({
      id: 'manual', kind: 'manual', finishedAt: '2026-07-12T00:10:00.000Z'
    })
    expect(repositories.runs.list(2).map((run) => run.id)).toEqual(['running', 'manual'])
  })
})
