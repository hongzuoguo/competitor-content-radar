import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { DesktopRuntime } from '../../src/main/runtime'
import type { Work } from '../../src/core/domain'
import { ImportService } from '../../src/services/import/import-service'
import { AppRepositories } from '../../src/services/database/repositories'

describe('desktop runtime assembly', () => {
  let database: AppDatabase

  beforeEach(() => { database = new AppDatabase(':memory:') })
  afterEach(() => database.close())

  it('persists creators, normalizes URLs and enforces the ten-creator limit', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/first?from_tab_name=main')
    expect((await runtime.listCreators())[0].profileUrl).toBe('https://www.douyin.com/user/first')

    for (let index = 1; index < 10; index += 1) {
      await runtime.addCreator(`https://www.douyin.com/user/${index}`)
    }
    await expect(runtime.addCreator('https://www.douyin.com/user/overflow')).rejects.toThrow('CREATOR_LIMIT_REACHED')
  })

  it('discovers, stores and processes recent works when run now is accepted', async () => {
    const work: Work = {
      id: 'douyin:7658', creatorId: '', platformWorkId: '7658', title: '测试作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/7658',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:7658', mediaPath: null,
      downloadUrl: 'https://video.example/7658.mp4',
      metrics: { likes: 12000, comments: 100, shares: 20, collects: 30 }
    }
    const discover = vi.fn(async (creatorId: string) => [{ ...work, creatorId }])
    const processWork = vi.fn(async () => ({
      transcript: '完整文案', provider: 'qwen', model: 'qwen3.7-plus', promptVersion: 'v1',
      result: { referenceValueScore: 88, referenceValueReason: '可迁移' },
      tokenUsage: { input: 10, output: 10 }
    }))
    const runtime = new DesktopRuntime(database, { discover, processWork, login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/first')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'qwen3.7-plus' })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(processWork).toHaveBeenCalledTimes(1))
    const dashboard = await runtime.getDashboard()
    expect(dashboard.newWorks).toBe(1)
    expect(dashboard.analyzedWorks).toBe(1)
    expect(dashboard.highlights).toHaveLength(1)
  })

  it('reports business idleness around a running collection', async () => {
    let finishDiscovery!: (works: Work[]) => void
    const discovery = new Promise<Work[]>((resolve) => { finishDiscovery = resolve })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(() => discovery), processWork: vi.fn(), login: vi.fn()
    })
    const becameIdle = vi.fn()
    runtime.onBusinessIdle(becameIdle)
    await runtime.addCreator('https://www.douyin.com/user/idle-check')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'qwen3.7-plus' })

    expect(runtime.isBusinessIdle()).toBe(true)
    const run = runtime.runNow()
    await expect(run).resolves.toEqual({ accepted: true })
    expect(runtime.isBusinessIdle()).toBe(false)
    expect((await runtime.getDashboard()).run.status).toBe('running')
    finishDiscovery([])
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(runtime.isBusinessIdle()).toBe(true)
    expect(becameIdle).toHaveBeenCalledTimes(1)
  })

  it('reports the stage and failure of a background run', async () => {
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockRejectedValue(new Error('采集失败')),
      processWork: vi.fn(), login: vi.fn(), report
    })
    await runtime.addCreator('https://www.douyin.com/user/log-check')
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await runtime.runNow()
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('error', '运行失败', expect.any(Error)))
    expect(report).toHaveBeenCalledWith('info', '开始采集博主', expect.objectContaining({ profileUrl: expect.any(String) }))
  })

  it('delegates import start and retry to the assembled import service', async () => {
    const imports = {
      start: vi.fn(async () => ({ accepted: true as const, workId: 'import-1' })),
      retry: vi.fn(async () => ({ accepted: true as const, workId: 'import-1' }))
    } as unknown as ImportService
    const runtime = new DesktopRuntime(
      database,
      { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() },
      imports
    )

    await expect(runtime.startImport({ source: { type: 'local', path: 'clip.mp4' }, creatorId: null }))
      .resolves.toEqual({ accepted: true, workId: 'import-1' })
    await expect(runtime.retryImport('import-1')).resolves.toEqual({ accepted: true, workId: 'import-1' })
    expect(imports.start).toHaveBeenCalledWith({ source: { type: 'local', path: 'clip.mp4' }, creatorId: null })
    expect(imports.retry).toHaveBeenCalledWith('import-1')
  })

  it('delegates failed-work deletion to the assembled import service', async () => {
    const imports = { deleteFailed: vi.fn(async () => undefined) } as unknown as ImportService
    const runtime = new DesktopRuntime(
      database,
      { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() },
      imports
    )

    await expect(runtime.deleteFailedWork('failed-1')).resolves.toBeUndefined()
    expect(imports.deleteFailed).toHaveBeenCalledWith('failed-1')
  })

  it('reports when failed-work deletion has no import service', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.deleteFailedWork('failed-1')).rejects.toThrow('IMPORT_SERVICE_UNAVAILABLE')
  })

  it('lists monitored and imported works with joined creator, job, analysis and artifact state', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-1', platform: 'douyin', name: 'Alice', profileUrl: 'https://www.douyin.com/user/alice', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' })
    repositories.works.upsert({ id: 'monitor-1', creatorId: 'creator-1', platformWorkId: '1', sourceType: 'douyin_monitor', sourceKey: 'douyin:1', mediaPath: null, title: 'Monitor', publishedAt: '2026-01-02T00:00:00.000Z', originalUrl: 'https://www.douyin.com/video/1', downloadUrl: null, metrics: { likes: 12, comments: 0, shares: 0, collects: 0 } })
    repositories.analyses.save({ workId: 'monitor-1', transcript: 'x', result: { referenceValueScore: 91, reasons: ['high_likes'] }, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null, createdAt: '2026-01-02T00:00:00.000Z' })
    repositories.works.upsert({ id: 'failed-1', creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: 'sha256:x', mediaPath: 'x.mp4', title: 'Failed', publishedAt: '2026-01-03T00:00:00.000Z', originalUrl: null, downloadUrl: null, metrics: { likes: 0, comments: 0, shares: 0, collects: 0 } })
    repositories.jobs.save({ workId: 'failed-1', stage: 'transcribed', status: 'failed', attemptCount: 1, nextAttemptAt: null, errorCode: 'AI_TIMEOUT', errorMessage: 'try again', updatedAt: '2026-01-03T00:00:00.000Z' })
    repositories.artifacts.save({ workId: 'failed-1', wavPath: 'x.wav', transcript: 'x', existingWorkId: 'monitor-1', updatedAt: '2026-01-03T00:00:00.000Z' })
    const imports = { isRetryable: vi.fn((id: string) => id === 'failed-1') } as unknown as ImportService
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)

    const works = await runtime.listWorks()
    expect(works).toEqual([
      expect.objectContaining({ id: 'failed-1', creatorId: null, creatorName: '未分类作品', status: 'failed', stage: 'transcribed', errorCode: 'AI_TIMEOUT', retryable: true, existingWorkId: 'monitor-1' }),
      expect.objectContaining({ id: 'monitor-1', creatorId: 'creator-1', creatorName: 'Alice', status: 'completed', stage: 'completed', likes: 12, referenceValueScore: 91 })
    ])
  })

  it('reads a real persisted import failure without losing its stable code or creator id', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-1', platform: 'douyin', name: 'Alice', profileUrl: 'https://www.douyin.com/user/alice', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' })
    const imports = new ImportService({
      repositories,
      mediaRoot: 'managed',
      ingestLocal: vi.fn().mockRejectedValue(Object.assign(new Error('C:\\private\\secret.mp4'), { code: 'MEDIA_COPY_FAILED' })),
      resolveDouyin: vi.fn(),
      download: vi.fn(),
      processor: { extractAudio: vi.fn(), transcribe: vi.fn(), analyze: vi.fn() },
      getSettings: vi.fn(() => ({}))
    })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)

    const started = await runtime.startImport({ source: { type: 'local', path: 'C:\\private\\secret.mp4' }, creatorId: 'creator-1' })
    await vi.waitFor(async () => expect((await runtime.listWorks()).find((work) => work.id === started.workId)?.status).toBe('failed'))
    expect((await runtime.listWorks()).find((work) => work.id === started.workId)).toMatchObject({
      creatorId: 'creator-1', creatorName: 'Alice', errorCode: 'MEDIA_COPY_FAILED', errorMessage: 'Import processing failed.'
    })
  })

  it('loads work list relations with a constant number of database queries', async () => {
    const repositories = new AppRepositories(database.connection)
    for (let index = 0; index < 4; index += 1) {
      repositories.works.upsert({ id: `work-${index}`, creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: `sha256:${index}`, mediaPath: `${index}.mp4`, title: `Work ${index}`, publishedAt: `2026-01-0${index + 1}T00:00:00.000Z`, originalUrl: null, downloadUrl: null, metrics: { likes: index, comments: 0, shares: 0, collects: 0 } })
      repositories.jobs.save({ workId: `work-${index}`, stage: 'completed', status: 'completed', attemptCount: 1, nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: '2026-01-01T00:00:00.000Z' })
    }
    const prepare = vi.spyOn(database.connection, 'prepare')
    const imports = { isRetryable: vi.fn(() => false) } as unknown as ImportService
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)

    await expect(runtime.listWorks()).resolves.toHaveLength(4)
    expect(prepare).toHaveBeenCalledTimes(5)
    expect(imports.isRetryable).not.toHaveBeenCalled()
  })

  it('bridges import work-state subscriptions and unsubscribe', () => {
    const unsubscribe = vi.fn()
    const imports = { subscribe: vi.fn(() => unsubscribe) } as unknown as ImportService
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)
    const listener = vi.fn()
    const stop = runtime.onWorkStateChanged(listener)
    expect(imports.subscribe).toHaveBeenCalledWith(listener)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
