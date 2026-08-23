import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { DesktopRuntime } from '../../src/main/runtime'
import { ImportService } from '../../src/services/import/import-service'
import { FEISHU_SYNC_STATE_KEY } from '../../src/services/feishu/sync-coordinator'
import { chinaDateKey } from '../../src/core/local-date'

describe('DesktopRuntime Feishu integration', () => {
  let database: AppDatabase | null = null

  afterEach(() => database?.close())

  it('delegates connection actions without exposing credentials', async () => {
    database = new AppDatabase(':memory:')
    const connected = {
      status: 'connected' as const,
      baseName: '对标内容雷达',
      baseUrl: 'https://example.feishu.cn/base/base-1',
      lastSyncedAt: null,
      message: '已连接',
      customAppConfigured: true,
      maskedAppId: 'cli_***mple'
    }
    const feishu = {
      getConnection: vi.fn(() => connected),
      connectCustomApp: vi.fn().mockResolvedValue(connected),
      repair: vi.fn().mockResolvedValue(connected),
      recreate: vi.fn().mockResolvedValue(connected),
      disconnect: vi.fn().mockResolvedValue({ ...connected, status: 'disconnected' as const }),
      syncAll: vi.fn().mockResolvedValue(connected),
      syncWork: vi.fn(),
      openDeveloperConsole: vi.fn()
    }
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), feishu
    })

    await expect(runtime.getFeishuConnection()).resolves.toMatchObject(connected)
    await runtime.connectFeishuCustomApp({
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await runtime.openFeishuDeveloperConsole()
    await runtime.repairFeishu('base-1')
    await runtime.recreateFeishu()
    await runtime.syncFeishu()
    await runtime.disconnectFeishu()

    expect(feishu.connectCustomApp).toHaveBeenCalledWith({
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    expect(feishu.openDeveloperConsole).toHaveBeenCalledOnce()
    expect(feishu.repair).toHaveBeenCalledWith('base-1')
    expect(feishu.recreate).toHaveBeenCalledOnce()
  })

  it('performs one initial full sync after connecting in auto mode when local works exist', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert(failedImportedWork('local-work'))
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.connectFeishuCustomApp({
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    expect(syncAll).toHaveBeenCalledOnce()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({
      hasPendingChanges: false,
      lastSyncSucceededAt: expect.any(String)
    })
  })

  it('does not perform an initial sync after connecting in manual mode', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert(failedImportedWork('local-work-manual'))
    repositories.settings.set(FEISHU_SYNC_STATE_KEY, {
      mode: 'manual', localRevision: 0, syncedRevision: 0,
      lastSyncAttemptAt: null, lastSyncSucceededAt: null, lastErrorCode: null
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.connectFeishuCustomApp({
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    expect(syncAll).not.toHaveBeenCalled()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({
      mode: 'manual', hasPendingChanges: true
    })
  })

  it('always performs an explicit manual Feishu sync without pending changes', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set(FEISHU_SYNC_STATE_KEY, {
      mode: 'manual', localRevision: 0, syncedRevision: 0,
      lastSyncAttemptAt: null, lastSyncSucceededAt: null, lastErrorCode: null
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.syncFeishu()

    expect(syncAll).toHaveBeenCalledOnce()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({
      mode: 'manual',
      hasPendingChanges: false,
      lastSyncAttemptAt: expect.any(String),
      lastSyncSucceededAt: expect.any(String)
    })
  })

  it('moves analyzed work through Feishu sync before completing', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({
      id: 'mine-1', creatorId: null, platformWorkId: null,
      sourceType: 'local_file', sourceKey: 'sha256:mine', mediaPath: 'mine.mp4',
      ownership: 'mine', title: '我的作品', publishedAt: '2026-07-25T00:00:00.000Z',
      originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const syncWork = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(),
      processWork: vi.fn().mockResolvedValue({
        transcript: '文案', result: {
          topicAngle: '角度',
          openingHook: { quote: '开头', type: '提问', mechanism: '好奇' },
          structure: ['一'], viralPoints: [],
          highlights: [], reusablePatterns: [],
          differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
        },
        provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null
      }),
      login: vi.fn(),
      feishu: {
        getConnection: () => ({
          status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example/base',
          lastSyncedAt: null, message: '已连接', customAppConfigured: true, maskedAppId: 'cli_***mple'
        }),
        connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(),
        disconnect: vi.fn(), syncAll: vi.fn(), syncWork
      }
    })
    await runtime.saveSettings({ providerId: 'test', modelId: 'test' })

    await runtime.analyzeWork('mine-1')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncWork).not.toHaveBeenCalled()
    expect(repositories.jobs.get('mine-1')).toMatchObject({ stage: 'completed', status: 'completed' })
    expect(repositories.analyses.get('mine-1')?.transcript).toBe('文案')
  })

  it('does not sync a manual run with no local changes', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-1', platform: 'douyin', name: '对标账号',
      profileUrl: 'https://www.douyin.com/user/example', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockResolvedValue({
      status: 'connected' as const, baseName: '对标内容雷达',
      baseUrl: 'https://example/base', lastSyncedAt: null, message: '已连接',
      customAppConfigured: true, maskedAppId: 'cli_***mple'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([]),
      processWork: vi.fn(),
      login: vi.fn(),
      feishu: {
        getConnection: () => ({
          status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example/base',
          lastSyncedAt: null, message: '已连接', customAppConfigured: true, maskedAppId: 'cli_***mple'
        }),
        connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(),
        disconnect: vi.fn(), syncAll, syncWork: vi.fn()
      }
    })

    await runtime.runNow('manual')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).not.toHaveBeenCalled()
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get())
      .toBeUndefined()
  })

  it('retries a Feishu-only run failure without collecting or analyzing again', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'run-feishu-failed',
      kind: 'manual',
      status: 'partial',
      startedAt: '2026-07-25T00:00:00.000Z',
      finishedAt: '2026-07-25T00:01:00.000Z',
      summary: {
        discovered: 2,
        selectedForAnalysis: 1,
        analyzed: 1,
        failures: [{
          creatorId: null,
          creatorName: '飞书多维表格',
          stage: 'feishu',
          code: 'FEISHU_SYNC_FAILED',
          message: '本地数据已保存',
          occurredAt: '2026-07-25T00:01:00.000Z'
        }]
      }
    })
    const discover = vi.fn()
    const processWork = vi.fn()
    const syncAll = vi.fn().mockResolvedValue({
      status: 'connected' as const,
      baseName: '对标内容雷达',
      baseUrl: 'https://example/base',
      lastSyncedAt: '2026-07-25T00:02:00.000Z',
      message: '已连接',
      customAppConfigured: true,
      maskedAppId: 'cli_***mple'
    })
    const runtime = new DesktopRuntime(database, {
      discover,
      processWork,
      login: vi.fn(),
      feishu: {
        getConnection: () => ({
          status: 'sync_error', baseName: '对标内容雷达', baseUrl: 'https://example/base',
          lastSyncedAt: null, message: '同步失败', customAppConfigured: true, maskedAppId: 'cli_***mple'
        }),
        connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(),
        disconnect: vi.fn(), syncAll, syncWork: vi.fn()
      }
    })

    await expect(runtime.retryRun('run-feishu-failed')).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).toHaveBeenCalledOnce()
    expect(discover).not.toHaveBeenCalled()
    expect(processWork).not.toHaveBeenCalled()
    expect(await runtime.listRuns()).toEqual([
      expect.objectContaining({ id: 'run-feishu-failed', status: 'completed', failures: [] })
    ])
    expect((await runtime.getDashboard()).run.stages.find((stage) => stage.id === 'feishu'))
      .toMatchObject({ status: 'completed' })
  })
  it('redacts errors reported by a failed Feishu retry', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'run-retry-redaction', kind: 'manual', status: 'partial',
      startedAt: '2026-07-25T00:00:00.000Z', finishedAt: '2026-07-25T00:01:00.000Z',
      summary: {
        failures: [{
          creatorId: null, creatorName: 'Feishu', stage: 'feishu', code: 'FEISHU_SYNC_FAILED',
          message: 'sync failed', occurredAt: '2026-07-25T00:01:00.000Z'
        }]
      }
    })
    const report = vi.fn()
    const syncAll = vi.fn().mockRejectedValue(new Error('FEISHU_API_1254302: Bearer secret-token'))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report,
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await expect(runtime.retryRun('run-retry-redaction')).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(report).toHaveBeenCalledWith('error', '飞书重试同步失败', { code: 'FEISHU_API_1254302' })
    expect(serializeReportCalls(report.mock.calls)).not.toContain('secret-token')
  })
  it('syncs changed work and analysis once after a run', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-1', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/creator-1', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const syncWork = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([discoveredWork('work-1', 'creator-1')]),
      processWork: vi.fn().mockResolvedValue(processedWork()), login: vi.fn(),
      feishu: connectedFeishu(syncAll, syncWork)
    })
    await runtime.saveSettings({ providerId: 'test', modelId: 'test' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).toHaveBeenCalledTimes(1)
    expect(syncWork).not.toHaveBeenCalled()
    expect(repositories.analyses.get('work-1')).not.toBeNull()
  })

  it('does not sync an identical rediscovery', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-unchanged', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/unchanged', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const work = {
      ...discoveredWork('work-unchanged', creator.id),
      publishedAt: '2026-06-01T00:00:00.000Z',
      metrics: { likes: 12, comments: 3, shares: 2, collects: 1 }
    }
    repositories.works.upsert(work)
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([work]), processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).not.toHaveBeenCalled()
  })

  it('does not sync a same-day snapshot when rediscovered metrics are identical', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-same-day', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/same-day', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const work = discoveredWork('work-same-day', creator.id)
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([work]), processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).toHaveBeenCalledTimes(1)
  })

  it('syncs metrics changes once at task end', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-metrics', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/metrics', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const work = discoveredWork('work-metrics', creator.id)
    repositories.works.upsert(work)
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([{ ...work, metrics: { ...work.metrics, likes: 2 } }]),
      processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).toHaveBeenCalledTimes(1)
  })

  it('preserves saved business data when task-end sync fails', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-sync-failure', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/sync-failure', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const report = vi.fn()
    const syncAll = vi.fn().mockRejectedValue(new Error('FEISHU_API_1254302: Bearer secret-token'))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([discoveredWork('work-sync-failure', 'creator-sync-failure')]),
      processWork: vi.fn().mockResolvedValue(processedWork()), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn()), report
    })
    await runtime.saveSettings({ providerId: 'test', modelId: 'test' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(repositories.works.get('work-sync-failure')).not.toBeNull()
    expect(repositories.analyses.get('work-sync-failure')).not.toBeNull()
    expect((await runtime.listRuns())[0]).toMatchObject({
      status: 'partial', failures: [expect.objectContaining({ code: 'FEISHU_SYNC_FAILED', stage: 'feishu' })]
    })
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({
      hasPendingChanges: true,
      lastErrorCode: 'FEISHU_API_1254302'
    })
    expect(report).toHaveBeenCalledWith('error', '飞书同步失败', { code: 'FEISHU_API_1254302' })
    expect(serializeReportCalls(report.mock.calls)).not.toContain('secret-token')
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial',
      message: '本地采集、转写和分析已完成；飞书同步尚未完成，请在设置中重试',
      requiresAction: true,
      failures: [expect.objectContaining({ code: 'FEISHU_SYNC_FAILED', stage: 'feishu' })]
    })
    expect((await runtime.getDashboard()).run.stages.find((stage) => stage.id === 'feishu'))
      .toMatchObject({ status: 'failed' })
  })

  it('adds failed Feishu sync guidance when collection has no analysis candidates', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-no-candidates', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/no-candidates', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockRejectedValue(new Error('FEISHU_SYNC_FAILED'))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([{
        ...discoveredWork('work-no-candidates', 'creator-no-candidates'),
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      }]),
      processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial',
      message: '作品采集已完成；没有符合当前规则且尚未分析的作品，本次未执行 AI 拆解；飞书同步尚未完成，请在设置中重试',
      requiresAction: true,
      failures: [expect.objectContaining({ code: 'FEISHU_SYNC_FAILED', stage: 'feishu' })]
    })
  })

  it('persists both creator collection and Feishu failures from the same run', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    for (const id of ['creator-discovery-fails', 'creator-syncs']) repositories.creators.create({
      id, platform: 'douyin', name: id, profileUrl: `https://www.douyin.com/user/${id}`,
      enabled: true, createdAt: '2026-07-25T00:00:00.000Z'
    })
    const discover = vi.fn().mockImplementation(async (creatorId: string) => {
      if (creatorId === 'creator-discovery-fails') throw Object.assign(new Error('failed'), { code: 'DOUYIN_CREATOR_COLLECTION_FAILED' })
      return [discoveredWork('work-mixed-failure', creatorId)]
    })
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(),
      feishu: connectedFeishu(vi.fn().mockRejectedValue(new Error('FEISHU_SYNC_FAILED')), vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect((await runtime.listRuns())[0]).toMatchObject({
      status: 'partial',
      failures: expect.arrayContaining([
        expect.objectContaining({ creatorId: 'creator-discovery-fails', stage: 'discovery' }),
        expect.objectContaining({ creatorId: null, code: 'FEISHU_SYNC_FAILED', stage: 'feishu' })
      ])
    })
    expect((await runtime.getDashboard()).run).toMatchObject({ status: 'partial', requiresAction: true })
  })

  it('retains earlier creator failures when a later Feishu operation is fatal', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    for (const id of ['creator-earlier-failure', 'creator-before-feishu']) repositories.creators.create({
      id, platform: 'douyin', name: id, profileUrl: `https://www.douyin.com/user/${id}`,
      enabled: true, createdAt: '2026-07-25T00:00:00.000Z'
    })
    const discover = vi.fn().mockImplementation(async (creatorId: string) => {
      if (creatorId === 'creator-earlier-failure') throw Object.assign(new Error('failed'), { code: 'DOUYIN_CREATOR_COLLECTION_FAILED' })
      return [discoveredWork('work-before-feishu', creatorId)]
    })
    let synced = false
    const feishu = connectedFeishu(vi.fn().mockImplementation(async () => { synced = true }), vi.fn())
    feishu.getConnection = vi.fn(() => {
      if (synced) throw Object.assign(new Error('hostile feishu'), { code: 'FEISHU_SYNC_FAILED' })
      return { status: 'connected', baseName: 'Base', baseUrl: 'https://example/base', tableNames: [], missingTableNames: [] }
    })
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn(), feishu })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    feishu.getConnection = vi.fn(() => ({
      status: 'sync_error', baseName: 'Base', baseUrl: 'https://example/base',
      lastSyncedAt: null, message: 'Sync failed', customAppConfigured: true, maskedAppId: 'cli_***'
    }))

    const expectedFailures = expect.arrayContaining([
      expect.objectContaining({ creatorId: 'creator-earlier-failure', stage: 'discovery' }),
      expect.objectContaining({ creatorId: null, code: 'FEISHU_SYNC_FAILED', stage: 'feishu' })
    ])
    expect((await runtime.listRuns())[0]).toMatchObject({ status: 'failed', failures: expectedFailures })
    expect((await runtime.getDashboard()).run).toMatchObject({ status: 'failed', failures: expectedFailures })
  })

  it('reports Feishu as disconnected when an old sync error remains in local state', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set(FEISHU_SYNC_STATE_KEY, {
      mode: 'auto', localRevision: 0, syncedRevision: 0,
      lastSyncAttemptAt: null, lastSyncSucceededAt: null, lastErrorCode: 'FEISHU_SYNC_FAILED'
    })
    repositories.creators.create({
      id: 'creator-disconnected', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/disconnected', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([{
        ...discoveredWork('work-disconnected', 'creator-disconnected'),
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      }]),
      processWork: vi.fn(), login: vi.fn(), feishu: disconnectedFeishu()
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'completed',
      message: '作品采集已完成；没有符合当前规则且尚未分析的作品，本次未执行 AI 拆解；飞书尚未连接',
      requiresAction: false
    })
  })

  it('adds pending Feishu guidance while waiting for model configuration', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-waiting-model', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/waiting-model', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([discoveredWork('work-waiting-model', 'creator-waiting-model')]),
      processWork: vi.fn(), login: vi.fn(), isModelConfigured: vi.fn(() => false),
      feishu: connectedFeishu(syncAll, vi.fn())
    })
    await runtime.saveSettings({ feishuSyncMode: 'manual' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).not.toHaveBeenCalled()
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial',
      message: '已完成作品采集，等待模型配置后进行转写和 AI 拆解；飞书有本地更新待同步',
      requiresAction: true
    })
  })

  it('adds pending Feishu guidance after a partial business run', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-partial', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/partial', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([discoveredWork('work-partial', 'creator-partial')]),
      processWork: vi.fn().mockRejectedValue(new Error('ANALYSIS_FAILED')), login: vi.fn(),
      feishu: connectedFeishu(syncAll, vi.fn())
    })
    await runtime.saveSettings({ providerId: 'test', modelId: 'test', feishuSyncMode: 'manual' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).not.toHaveBeenCalled()
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial',
      message: '本次运行部分完成，请查看失败项后重试；飞书有本地更新待同步',
      requiresAction: true
    })
  })

  it('flushes changed local data once when an unexpected run error reaches the task boundary', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-unexpected-run-error', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/unexpected-run-error', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockRejectedValue(new Error('FEISHU_SYNC_FAILED'))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([discoveredWork('work-unexpected-run-error', 'creator-unexpected-run-error')]),
      processWork: vi.fn(), login: vi.fn(),
      isModelConfigured: vi.fn()
        .mockImplementationOnce(() => { throw new Error('UNEXPECTED_RUNTIME_FAILURE') })
        .mockReturnValue(true),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(repositories.works.get('work-unexpected-run-error')).not.toBeNull()
    expect(syncAll).toHaveBeenCalledOnce()
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'failed', message: '作品处理失败，请检查模型设置后重试。', requiresAction: true,
      failures: [expect.objectContaining({ code: 'WORK_PROCESSING_FAILED', stage: 'analysis' })]
    })
  })

  it('does not flush unchanged local data when an unexpected run error reaches the task boundary', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-unchanged-run-error', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/unchanged-run-error', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const work = discoveredWork('work-unchanged-run-error', creator.id)
    repositories.works.upsert(work)
    const capturedAt = new Date().toISOString()
    repositories.snapshots.create({
      id: `${work.id}:${chinaDateKey(capturedAt)}`,
      workId: work.id,
      capturedAt,
      metrics: work.metrics
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([work]), processWork: vi.fn(), login: vi.fn(),
      isModelConfigured: vi.fn(() => { throw new Error('UNEXPECTED_RUNTIME_FAILURE') }),
      feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).not.toHaveBeenCalled()
  })

  it('syncs changed creator metadata once but ignores matching metadata', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-metadata', platform: 'douyin', name: 'Old name',
      profileUrl: 'https://www.douyin.com/user/old', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue({
        creator: { name: 'New name', profileUrl: 'https://www.douyin.com/user/new' }, works: []
      }),
      processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(syncAll).toHaveBeenCalledTimes(1)
  })

  it('queues a changed task flush behind an explicit sync while Feishu is syncing data', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-in-flight', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/in-flight', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const pending = deferred()
    let status: 'connected' | 'syncing_data' = 'connected'
    const syncAll = vi.fn(async () => {
      status = 'syncing_data'
      await pending.promise
      status = 'connected'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: feishuWithStatus(syncAll, () => status)
    })

    const explicitSync = runtime.syncFeishu()
    await vi.waitFor(() => expect(syncAll).toHaveBeenCalledOnce())
    const changedTask = runtime.toggleCreator('creator-in-flight', false)
    pending.resolve()
    await Promise.all([explicitSync, changedTask])

    expect(syncAll).toHaveBeenCalledTimes(2)
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({ hasPendingChanges: false })
  })

  it('does not retry after an in-flight explicit sync fails', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-in-flight-failure', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/in-flight-failure', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    void pending.catch(() => undefined)
    let status: 'connected' | 'syncing_data' = 'connected'
    const syncAll = vi.fn(async () => {
      status = 'syncing_data'
      await pending
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: feishuWithStatus(syncAll, () => status)
    })

    const explicitSync = runtime.syncFeishu()
    await vi.waitFor(() => expect(syncAll).toHaveBeenCalledOnce())
    const changedTask = runtime.toggleCreator('creator-in-flight-failure', false)
    reject(new Error('FEISHU_SYNC_FAILED'))
    await expect(explicitSync).rejects.toThrow('FEISHU_SYNC_FAILED')
    await changedTask

    expect(syncAll).toHaveBeenCalledOnce()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({ hasPendingChanges: true })
  })

  it('follows an external in-flight Feishu sync with a fresh task-end flush', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-external-sync', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/external-sync', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const pending = deferred()
    let status: 'connected' | 'syncing_data' = 'syncing_data'
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: feishuWithStatus(syncAll, () => status, async () => {
        await pending.promise
        status = 'connected'
      })
    })

    const changedTask = runtime.toggleCreator('creator-external-sync', false)
    pending.resolve()
    await changedTask

    expect(syncAll).toHaveBeenCalledOnce()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({ hasPendingChanges: false })
  })

  it('does not start a fresh flush when an external in-flight Feishu sync fails', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-external-failure', platform: 'douyin', name: 'Creator',
      profileUrl: 'https://www.douyin.com/user/external-failure', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    let status: 'connected' | 'syncing_data' = 'syncing_data'
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      feishu: feishuWithStatus(syncAll, () => status, () => pending)
    })

    const changedTask = runtime.toggleCreator('creator-external-failure', false)
    reject(new Error('FEISHU_SYNC_FAILED'))
    await changedTask

    expect(syncAll).not.toHaveBeenCalled()
    await expect(runtime.getFeishuConnection()).resolves.toMatchObject({ hasPendingChanges: true })
  })

  it('flushes a successful failed-import deletion after marking its removed Feishu row', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert(failedImportedWork('failed-delete'))
    repositories.jobs.save(failedImportJob('failed-delete'))
    const syncAll = vi.fn().mockResolvedValue(undefined)
    let runtime!: DesktopRuntime
    const imports = new ImportService(importDependencies(repositories, () => runtime.markFeishuLocalChange()))
    runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    }, imports)

    await runtime.deleteFailedWork('failed-delete')

    expect(repositories.works.get('failed-delete')).toBeNull()
    expect(syncAll).toHaveBeenCalledOnce()
  })

  it('does not flush when failed-import deletion is rejected before local data changes', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert(failedImportedWork('failed-delete-rejected'))
    repositories.jobs.save({ ...failedImportJob('failed-delete-rejected'), status: 'completed' })
    const syncAll = vi.fn().mockResolvedValue(undefined)
    let runtime!: DesktopRuntime
    const imports = new ImportService(importDependencies(repositories, () => runtime.markFeishuLocalChange()))
    runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    }, imports)

    await expect(runtime.deleteFailedWork('failed-delete-rejected')).rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })

    expect(repositories.works.get('failed-delete-rejected')).not.toBeNull()
    expect(syncAll).not.toHaveBeenCalled()
  })

  it('does not flush when a failed-import deletion rolls back after its local change marker fails', async () => {
    database = new AppDatabase(':memory:')
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert(failedImportedWork('failed-delete-marker'))
    repositories.jobs.save(failedImportJob('failed-delete-marker'))
    const syncAll = vi.fn().mockResolvedValue(undefined)
    const imports = new ImportService(importDependencies(repositories, () => {
      throw new Error('SYNC_STATE_WRITE_FAILED')
    }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), feishu: connectedFeishu(syncAll, vi.fn())
    }, imports)

    await expect(runtime.deleteFailedWork('failed-delete-marker')).rejects.toThrow('SYNC_STATE_WRITE_FAILED')

    expect(repositories.works.get('failed-delete-marker')).not.toBeNull()
    expect(syncAll).not.toHaveBeenCalled()
  })
})

function importDependencies(repositories: AppRepositories, onLocalDataChanged: () => void) {
  return {
    repositories,
    mediaRoot: 'managed',
    ingestLocal: vi.fn(),
    resolveDouyin: vi.fn(),
    download: vi.fn(),
    processor: {
      extractAudio: vi.fn(), transcribe: vi.fn(), analyze: vi.fn()
    },
    getSettings: vi.fn(),
    onLocalDataChanged,
    removeManagedWorkDirectory: vi.fn(async () => undefined)
  }
}

function failedImportedWork(id: string) {
  return {
    id, creatorId: null, platformWorkId: null, sourceType: 'local_file' as const,
    sourceKey: `sha256:${id}`, mediaPath: null, ownership: 'mine' as const,
    title: 'Failed import', publishedAt: '2026-08-09T00:00:00.000Z', originalUrl: null, downloadUrl: null,
    metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
  }
}

function failedImportJob(workId: string) {
  return {
    workId, stage: 'transcribed' as const, status: 'failed' as const, attemptCount: 1,
    nextAttemptAt: null, errorCode: 'AI_FAILED', errorMessage: null, updatedAt: '2026-08-09T00:00:00.000Z'
  }
}

function connectedFeishu(syncAll: () => Promise<unknown>, syncWork: () => void) {
  const connection = {
    status: 'connected' as const, baseName: 'Feishu', baseUrl: 'https://example/base',
    lastSyncedAt: null, message: 'Connected', customAppConfigured: true, maskedAppId: 'cli_***mple'
  }
  return {
    getConnection: () => connection,
    connectCustomApp: vi.fn().mockResolvedValue(connection),
    repair: vi.fn().mockResolvedValue(connection),
    recreate: vi.fn().mockResolvedValue(connection),
    disconnect: vi.fn(), syncAll, syncWork
  }
}

function disconnectedFeishu() {
  const connection = {
    status: 'disconnected' as const, baseName: null, baseUrl: null,
    lastSyncedAt: null, message: '', customAppConfigured: false, maskedAppId: null
  }
  return {
    getConnection: () => connection,
    connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(), disconnect: vi.fn(),
    syncAll: vi.fn(), syncWork: vi.fn()
  }
}

function feishuWithStatus(
  syncAll: () => Promise<unknown>,
  status: () => 'connected' | 'syncing_data',
  waitForActiveDataSync?: () => Promise<void>
) {
  return {
    getConnection: () => ({
      status: status(), baseName: 'Feishu', baseUrl: 'https://example/base',
      lastSyncedAt: null, message: 'Connected', customAppConfigured: true, maskedAppId: 'cli_***mple'
    }),
    connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(), disconnect: vi.fn(), syncAll, syncWork: vi.fn(),
    ...(waitForActiveDataSync ? { waitForActiveDataSync } : {})
  }
}

function discoveredWork(id: string, creatorId: string) {
  return {
    id, creatorId, platformWorkId: id, sourceType: 'douyin_monitor' as const, sourceKey: `douyin:${id}`,
    mediaPath: null, title: id, publishedAt: new Date().toISOString(), originalUrl: `https://www.douyin.com/video/${id}`,
    downloadUrl: null, metrics: { likes: 12000, comments: 0, shares: 0, collects: 0 }
  }
}

function processedWork() {
  return {
    transcript: 'transcript', result: {}, provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null
  }
}

function serializeReportCalls(calls: unknown[][]): string {
  return calls.map((call) => call.map((value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
    return JSON.stringify(value)
  }).join('|')).join('\n')
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
