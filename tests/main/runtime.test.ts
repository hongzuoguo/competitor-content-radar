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

  it('migrates legacy daily monitoring times to the fixed 08:00 schedule', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('app.publicSettings', { dailyTime: '09:00', weeklyTime: '09:30' })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getSettings()).resolves.toMatchObject({ dailyTime: '08:00' })
    expect(repositories.settings.get<{ dailyTime: string }>('app.publicSettings')).toMatchObject({ dailyTime: '08:00' })
  })

  it('does not allow settings writes to change the fixed 08:00 schedule', async () => {
    const repositories = new AppRepositories(database.connection)
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.saveSettings({ dailyTime: '10:30' })).resolves.toMatchObject({ dailyTime: '08:00' })
    expect(repositories.settings.get<{ dailyTime: string }>('app.publicSettings')).toMatchObject({ dailyTime: '08:00' })
  })

  it('persists creators, normalizes URLs and enforces the ten-creator limit', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/first?from_tab_name=main')
    expect((await runtime.listCreators())[0].profileUrl).toBe('https://www.douyin.com/user/first')

    for (let index = 1; index < 10; index += 1) {
      await runtime.addCreator(`https://www.douyin.com/user/${index}`)
    }
    await expect(runtime.addCreator('https://www.douyin.com/user/overflow')).rejects.toThrow('CREATOR_LIMIT_REACHED')
  })

  it('resolves a creator card through the runtime port before saving it', async () => {
    const resolveCreatorInput = vi.fn(async () => 'https://www.douyin.com/user/resolved-user')
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), resolveCreatorInput
    })

    await runtime.addCreator('复制这条消息 https://v.douyin.com/short-card/')

    expect(resolveCreatorInput).toHaveBeenCalledWith('复制这条消息 https://v.douyin.com/short-card/')
    expect(await runtime.listCreators()).toEqual([
      expect.objectContaining({ profileUrl: 'https://www.douyin.com/user/resolved-user' })
    ])
  })

  it('returns the existing creator when the same resolved profile is added again', async () => {
    const resolveCreatorInput = vi.fn(async () => 'https://www.douyin.com/user/resolved-user')
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), resolveCreatorInput
    })

    const first = await runtime.addCreator('https://v.douyin.com/first-card/')
    const duplicate = await runtime.addCreator('https://v.douyin.com/same-card/')

    expect(duplicate).toEqual(first)
    expect(await runtime.listCreators()).toHaveLength(1)
  })

  it('returns the saved creator before the first background capture completes', async () => {
    let finishDiscovery!: (works: Work[]) => void
    const discovery = new Promise<Work[]>((resolve) => { finishDiscovery = resolve })
    const discover = vi.fn(() => discovery)
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn()
    })

    const creator = await runtime.addCreator('https://www.douyin.com/user/first-capture')

    expect(new AppRepositories(database.connection).creators.list().find((item) => item.id === creator.id)).toMatchObject({
      profileUrl: 'https://www.douyin.com/user/first-capture'
    })
    expect(discover).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl)

    finishDiscovery([])
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
  })

  it('keeps a newly added creator when its first capture is deferred by an active run', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'existing', platform: 'douyin', name: 'Existing', enabled: true,
      profileUrl: 'https://www.douyin.com/user/existing', createdAt: new Date().toISOString()
    })
    let finishDiscovery!: (works: Work[]) => void
    const discovery = new Promise<Work[]>((resolve) => { finishDiscovery = resolve })
    const discover = vi.fn(() => discovery)
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(), report
    })
    await runtime.runNow('daily')

    const creator = await runtime.addCreator('https://www.douyin.com/user/deferred')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(repositories.creators.list().find((item) => item.id === creator.id)).toMatchObject({ enabled: true })
    expect(discover).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('info', 'First capture deferred', expect.objectContaining({
      creatorId: creator.id
    }))

    finishDiscovery([])
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    await runtime.runNow('catch_up')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl)
  })

  it('records a first-capture startup failure without rejecting creator creation', async () => {
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report
    })
    vi.spyOn(runtime, 'runNow').mockRejectedValueOnce(new Error('startup failed'))

    const creator = await runtime.addCreator('https://www.douyin.com/user/startup-failure')
    expect(creator.profileUrl).toBe('https://www.douyin.com/user/startup-failure')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(report).toHaveBeenCalledWith('error', 'First capture start failed', {
      code: 'FIRST_CAPTURE_START_FAILED', creatorId: creator.id
    })
  })

  it('contains reporting failures from the fire-and-forget first capture chain', async () => {
    const report = vi.fn(() => { throw new Error('logger unavailable') })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report
    })
    vi.spyOn(runtime, 'runNow').mockRejectedValueOnce(new Error('private path C:\\secret'))

    await expect(runtime.addCreator('https://www.douyin.com/user/safe-reporting')).resolves.toMatchObject({
      profileUrl: 'https://www.douyin.com/user/safe-reporting'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(report).toHaveBeenCalledWith('error', 'First capture start failed', expect.objectContaining({
      code: 'FIRST_CAPTURE_START_FAILED'
    }))
  })

  it('lets an immediate manual run replace the pending first capture without a duplicate run', async () => {
    const discover = vi.fn(async () => [])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn()
    })
    const creator = await runtime.addCreator('https://www.douyin.com/user/manual-replaces')

    await runtime.runNow('manual')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl)
  })

  it('coalesces consecutive creator additions into one first run that covers both creators', async () => {
    const discover = vi.fn(async () => [])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn()
    })
    const first = await runtime.addCreator('https://www.douyin.com/user/coalesced-first')
    const second = await runtime.addCreator('https://www.douyin.com/user/coalesced-second')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(discover).toHaveBeenCalledTimes(2)
    expect(discover).toHaveBeenCalledWith(first.id, first.profileUrl)
    expect(discover).toHaveBeenCalledWith(second.id, second.profileUrl)
    const runCount = database.connection.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }
    expect(runCount.count).toBe(1)
  })

  it('cancels a pending first capture before the database closes', async () => {
    const discover = vi.fn(async () => [])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/shutdown')

    runtime.shutdown()
    database.close()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(discover).not.toHaveBeenCalled()
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

  it('stores discovered works when no AI provider is configured', async () => {
    const discover = vi.fn(async (creatorId: string) => [{
      id: 'discovery-only', creatorId, platformWorkId: '1', title: 'Discovery only',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/1',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:1', mediaPath: null, downloadUrl: null,
      metrics: { likes: 1, comments: 2, shares: 3, collects: 4 }
    }])
    const processWork = vi.fn()
    const runtime = new DesktopRuntime(database, { discover, processWork, login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/discovery-only')

    expect(await runtime.runNow('daily')).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(await runtime.listWorks()).toEqual([
      expect.objectContaining({ id: 'discovery-only', likes: 1 })
    ])
    expect(processWork).not.toHaveBeenCalled()
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial', requiresAction: true
    })
    expect((await runtime.getDashboard()).run.message).toContain('等待模型')
  })

  it('continues after one work analysis fails', async () => {
    const now = new Date().toISOString()
    const discover = vi.fn(async (creatorId: string) => ['first', 'second'].map((id) => ({
      id, creatorId, platformWorkId: id, title: id, publishedAt: now,
      originalUrl: `https://www.douyin.com/video/${id}`, sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${id}`, mediaPath: null, downloadUrl: null,
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })))
    const processWork = vi.fn()
      .mockRejectedValueOnce(new Error('analysis failed'))
      .mockResolvedValueOnce({
        transcript: 'second transcript', result: {}, provider: 'qwen', model: 'model',
        promptVersion: 'v1', tokenUsage: null
      })
    const runtime = new DesktopRuntime(database, { discover, processWork, login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/work-isolation')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'model' })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).toHaveBeenCalledTimes(2)
    expect(new AppRepositories(database.connection).analyses.get('second')?.transcript).toBe('second transcript')
    const run = (await runtime.getDashboard()).run
    expect(run.status).toBe('partial')
    expect(run.message).toContain('部分完成')
    expect(run.stages.find((stage) => stage.id === 'analysis')?.status).not.toBe('completed')
  })

  it('continues after saving one work analysis fails', async () => {
    database.connection.exec(`
      CREATE TRIGGER fail_first_analysis
      BEFORE INSERT ON analyses
      WHEN NEW.work_id = 'first-save-fails'
      BEGIN
        SELECT RAISE(FAIL, 'analysis save failed');
      END;
    `)
    const now = new Date().toISOString()
    const discover = vi.fn(async (creatorId: string) => ['first-save-fails', 'second-save-succeeds'].map((id) => ({
      id, creatorId, platformWorkId: id, title: id, publishedAt: now,
      originalUrl: `https://www.douyin.com/video/${id}`, sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${id}`, mediaPath: null, downloadUrl: null,
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })))
    const processWork = vi.fn(async () => ({
      transcript: 'transcript', result: {}, provider: 'qwen', model: 'model',
      promptVersion: 'v1', tokenUsage: null
    }))
    const runtime = new DesktopRuntime(database, { discover, processWork, login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/save-isolation')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'model' })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).toHaveBeenCalledTimes(2)
    expect(new AppRepositories(database.connection).analyses.get('second-save-succeeds')).not.toBeNull()
    expect((await runtime.getDashboard()).run.status).toBe('partial')
  })

  it('continues after one creator discovery fails', async () => {
    const discover = vi.fn()
      .mockRejectedValueOnce(new Error('creator failed'))
      .mockImplementationOnce(async (creatorId: string) => [{
        id: 'survivor', creatorId, platformWorkId: '2', title: 'Survivor',
        publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/2',
        sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:2', mediaPath: null, downloadUrl: null,
        metrics: { likes: 2, comments: 0, shares: 0, collects: 0 }
      }])
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/failing')
    await runtime.addCreator('https://www.douyin.com/user/surviving')

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(discover).toHaveBeenCalledTimes(2)
    expect(await runtime.listWorks()).toEqual([expect.objectContaining({ id: 'survivor' })])
    expect((await runtime.getDashboard()).run.status).toBe('partial')
  })

  it('persists the completed daily run used by startup catch-up', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async () => []), processWork: vi.fn(), login: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/persisted-run')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'model' })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    const persisted = new AppRepositories(database.connection).runs.latestCompletedDaily()
    expect(persisted).toMatchObject({ kind: 'daily', status: 'completed' })
    expect(persisted?.finishedAt).toEqual(expect.any(String))
    expect(runtime.latestCompletedDailyRunAt()?.toISOString()).toBe(persisted?.finishedAt)
  })

  it('restores the last completed daily run after restart', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'restart-creator', platform: 'douyin', name: 'Restart creator', enabled: true,
      profileUrl: 'https://www.douyin.com/user/restart', createdAt: '2026-07-10T00:00:00.000Z'
    })
    repositories.runs.save({
      id: 'restart-run', kind: 'daily', status: 'partial',
      startedAt: '2026-07-11T00:00:00.000Z', finishedAt: '2026-07-11T00:10:00.000Z', summary: null
    })

    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    expect((await runtime.getDashboard()).lastRunAt).toBe('2026-07-11T00:10:00.000Z')
    expect((await runtime.listCreators())[0]).toMatchObject({ status: 'ready' })
    expect((await runtime.listCreators())[0].lastRun).not.toBe('尚未采集')
  })

  it('restores lastRunAt when only a manual run has finished', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'manual-only', kind: 'manual', status: 'completed',
      startedAt: '2026-07-12T01:00:00.000Z', finishedAt: '2026-07-12T01:10:00.000Z', summary: null
    })

    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    expect((await runtime.getDashboard()).lastRunAt).toBe('2026-07-12T01:10:00.000Z')
    expect(runtime.latestCompletedDailyRunAt()).toBeNull()
  })

  it('restores lastRunAt from a manual run newer than the latest daily run', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'older-daily', kind: 'daily', status: 'completed',
      startedAt: '2026-07-11T00:00:00.000Z', finishedAt: '2026-07-11T00:10:00.000Z', summary: null
    })
    repositories.runs.save({
      id: 'newer-manual', kind: 'manual', status: 'partial',
      startedAt: '2026-07-12T01:00:00.000Z', finishedAt: '2026-07-12T01:10:00.000Z', summary: null
    })

    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    expect((await runtime.getDashboard()).lastRunAt).toBe('2026-07-12T01:10:00.000Z')
    expect(runtime.latestCompletedDailyRunAt()?.toISOString()).toBe('2026-07-11T00:10:00.000Z')
  })

  it('persists a fatal run failure with finishedAt', async () => {
    database.connection.exec(`
      CREATE TRIGGER fail_snapshot
      BEFORE INSERT ON metric_snapshots
      BEGIN
        SELECT RAISE(FAIL, 'snapshot failed');
      END;
    `)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async (creatorId: string) => [{
        id: 'fatal-work', creatorId, platformWorkId: 'fatal', title: 'Fatal',
        publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
        sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:fatal', mediaPath: null,
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      }]),
      processWork: vi.fn(), login: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/fatal-run')

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    const run = database.connection.prepare(
      "SELECT status, finished_at, summary_json FROM runs WHERE kind = 'daily' ORDER BY started_at DESC LIMIT 1"
    ).get() as { status: string; finished_at: string | null; summary_json: string | null }
    expect(run.status).toBe('failed')
    expect(run.finished_at).toEqual(expect.any(String))
    expect(JSON.parse(run.summary_json ?? '{}')).toMatchObject({ error: 'RUN_FAILED' })
  })

  it('rolls back a work when its metric snapshot cannot be saved', async () => {
    database.connection.exec(`
      CREATE TRIGGER fail_atomic_snapshot
      BEFORE INSERT ON metric_snapshots
      WHEN NEW.work_id = 'atomic-work'
      BEGIN
        SELECT RAISE(FAIL, 'snapshot failed');
      END;
    `)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async (creatorId: string) => [{
        id: 'atomic-work', creatorId, platformWorkId: 'atomic', title: 'Atomic',
        publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
        sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:atomic', mediaPath: null,
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      }]),
      processWork: vi.fn(), login: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/atomic-run')

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(new AppRepositories(database.connection).works.get('atomic-work')).toBeNull()
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

  it('reports an isolated creator failure as a partial background run', async () => {
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockRejectedValue(new Error('采集失败')),
      processWork: vi.fn(), login: vi.fn(), report
    })
    await runtime.addCreator('https://www.douyin.com/user/log-check')
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(report).toHaveBeenCalledWith('error', '博主采集失败', expect.objectContaining({
      creatorId: expect.any(String), error: expect.any(Error)
    }))
    expect(report).toHaveBeenCalledWith('info', '开始采集博主', expect.objectContaining({ profileUrl: expect.any(String) }))
    expect((await runtime.getDashboard()).run.status).toBe('partial')
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

  it('returns a typed work detail assembled from persisted relations', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-1', platform: 'douyin', name: 'Alice', profileUrl: 'https://www.douyin.com/user/alice', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' })
    repositories.works.upsert({ id: 'detail-1', creatorId: 'creator-1', platformWorkId: '1', sourceType: 'douyin_monitor', sourceKey: 'douyin:detail-1', mediaPath: null, title: 'Detail', publishedAt: '2026-01-02T00:00:00.000Z', originalUrl: 'https://www.douyin.com/video/detail-1', downloadUrl: null, metrics: { likes: 12000, comments: 34, shares: 56, collects: 78 } })
    const result = {
      topicAngle: 'angle', openingHook: { quote: 'quote', type: 'type', mechanism: 'mechanism' },
      structure: ['one'], viralPoints: ['point'], interactionGuidance: 'guide', highlights: ['highlight'],
      reusablePatterns: ['pattern'], differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] },
      referenceValueScore: 91, referenceValueReason: 'reason', untrustedExtra: 'must not cross IPC'
    }
    repositories.analyses.save({ workId: 'detail-1', transcript: 'analysis transcript', result, provider: 'deepseek', model: 'chat', promptVersion: 'v1', tokenUsage: null, createdAt: '2026-01-03T00:00:00.000Z' })
    repositories.artifacts.save({ workId: 'detail-1', wavPath: 'detail.wav', transcript: 'artifact transcript', existingWorkId: null, updatedAt: '2026-01-02T12:00:00.000Z' })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getWork('detail-1')).resolves.toEqual(expect.objectContaining({
      id: 'detail-1', creatorName: 'Alice', originalUrl: 'https://www.douyin.com/video/detail-1',
      likes: 12000, comments: 34, shares: 56, collects: 78,
      transcript: 'analysis transcript', analysis: {
        topicAngle: 'angle', openingHook: { quote: 'quote', type: 'type', mechanism: 'mechanism' },
        structure: ['one'], viralPoints: ['point'], interactionGuidance: 'guide', highlights: ['highlight'],
        reusablePatterns: ['pattern'], differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] },
        referenceValueScore: 91, referenceValueReason: 'reason'
      }, analysisProvider: 'deepseek', analyzedAt: '2026-01-03T00:00:00.000Z'
    }))
  })

  it('keeps analysis metadata but returns null for malformed persisted analysis', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({ id: 'malformed-1', creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: 'sha256:malformed', mediaPath: 'malformed.mp4', title: 'Malformed', publishedAt: '2026-01-02T00:00:00.000Z', originalUrl: null, downloadUrl: null, metrics: { likes: 0, comments: 0, shares: 0, collects: 0 } })
    repositories.analyses.save({ workId: 'malformed-1', transcript: 'safe transcript', result: { topicAngle: 42 }, provider: 'qwen', model: 'chat', promptVersion: 'v1', tokenUsage: null, createdAt: '2026-01-03T00:00:00.000Z' })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getWork('malformed-1')).resolves.toEqual(expect.objectContaining({
      transcript: 'safe transcript', analysis: null, analysisProvider: 'qwen', analyzedAt: '2026-01-03T00:00:00.000Z'
    }))
  })

  it('returns null for an unknown work detail id', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getWork('missing')).resolves.toBeNull()
  })

  it('notifies live work listeners after monitored discovery and analysis persistence', async () => {
    const discovered: Work = {
      id: 'monitored-1', creatorId: '', platformWorkId: '1', sourceType: 'douyin_monitor', sourceKey: 'douyin:monitored-1',
      mediaPath: null, title: 'Monitored', publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/1',
      downloadUrl: null, metrics: { likes: 1, comments: 2, shares: 3, collects: 4 }
    }
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async (creatorId: string) => [{ ...discovered, creatorId }]),
      processWork: vi.fn(async () => ({ transcript: 'done', result: {}, provider: 'deepseek', model: 'chat', promptVersion: 'v1', tokenUsage: null })),
      login: vi.fn()
    })
    const persistedStates: boolean[] = []
    const listener = vi.fn(() => {
      const repositories = new AppRepositories(database.connection)
      expect(repositories.works.get('monitored-1')).not.toBeNull()
      expect(repositories.snapshots.listByWork('monitored-1')).toHaveLength(1)
      persistedStates.push(repositories.analyses.get('monitored-1') !== null)
    })
    runtime.onWorkStateChanged(() => { throw new Error('listener failed') })
    runtime.onWorkStateChanged(listener)
    await runtime.addCreator('https://www.douyin.com/user/live-monitor')
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'chat' })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(listener.mock.calls).toEqual([['monitored-1'], ['monitored-1']])
    expect(persistedStates).toEqual([false, true])
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
    expect(prepare).toHaveBeenCalledTimes(6)
    expect(imports.isRetryable).not.toHaveBeenCalled()
  })

  it('bridges import work-state subscriptions and unsubscribe', () => {
    const unsubscribe = vi.fn()
    const imports = { subscribe: vi.fn(() => unsubscribe) } as unknown as ImportService
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)
    const listener = vi.fn()
    const stop = runtime.onWorkStateChanged(listener)
    const bridge = vi.mocked(imports.subscribe).mock.calls[0][0]
    bridge('import-1')
    expect(listener).toHaveBeenCalledWith('import-1')
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
