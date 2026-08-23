import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { AppDatabase } from '../../src/services/database/database'
import { DesktopRuntime } from '../../src/main/runtime'
import type { Work } from '../../src/core/domain'
import { ImportService } from '../../src/services/import/import-service'
import { AppRepositories } from '../../src/services/database/repositories'
import { FEISHU_SYNC_STATE_KEY } from '../../src/services/feishu/sync-coordinator'

describe('desktop runtime assembly', () => {
  let database: AppDatabase

  beforeEach(() => { database = new AppDatabase(':memory:') })
  afterEach(() => database.close())

  it('opens the dedicated login browser without claiming login succeeded immediately', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login })

    await runtime.loginDouyin()

    expect(login).toHaveBeenCalledOnce()
    expect((await runtime.getSettings()).douyinLoggedIn).not.toBe(true)
  })

  it('marks the dedicated Douyin session as logged in after successful discovery', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([]), processWork: vi.fn(), login: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/login-confirmed')

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    await expect(runtime.getSettings()).resolves.toMatchObject({ douyinLoggedIn: true })
  })

  it('defaults, saves and validates the configurable analysis scope', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      analysisMaxWorksPerCreator: 10,
      analysisRecentDays: 30
    })
    await expect(runtime.saveSettings({
      analysisMaxWorksPerCreator: 6,
      analysisRecentDays: 45
    })).resolves.toMatchObject({
      analysisMaxWorksPerCreator: 6,
      analysisRecentDays: 45
    })
    await expect(runtime.saveSettings({ analysisMaxWorksPerCreator: 0 })).rejects.toThrow('INVALID_ANALYSIS_MAX_WORKS')
    await expect(runtime.saveSettings({ analysisRecentDays: 366 })).rejects.toThrow('INVALID_ANALYSIS_RECENT_DAYS')
    expect(new AppRepositories(database.connection).settings.get('app.publicSettings')).toMatchObject({
      analysisMaxWorksPerCreator: 6,
      analysisRecentDays: 45
    })
  })

  it('saves and validates the optional local Codex reasoning effort', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.saveSettings({ agentReasoningEffort: 'max' })).resolves.toMatchObject({
      agentReasoningEffort: 'max'
    })
    await expect(runtime.saveSettings({
      agentReasoningEffort: 'turbo' as unknown as 'max'
    })).rejects.toThrow('INVALID_AGENT_REASONING_EFFORT')
  })

  it('notifies only after committed Codex model or reasoning changes, including recommended reset', async () => {
    const onCodexSettingsChanged = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), onCodexSettingsChanged
    })

    await runtime.saveSettings({ analysisRecentDays: 45 })
    await runtime.saveSettings({ agentModel: 'gpt-5.6-terra' })
    await runtime.saveSettings({ agentModel: 'gpt-5.6-terra' })
    await runtime.saveSettings({ agentReasoningEffort: 'high' })
    await runtime.restoreRecommendedBehaviorSettings()

    expect(onCodexSettingsChanged).toHaveBeenCalledTimes(3)
  })

  it('migrates a legacy Codex model with an embedded reasoning suffix', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('app.publicSettings', {
      runEngine: 'local-agent',
      agentModel: 'gpt-5.6-terra-high'
    })
    repositories.settings.set('app.publicSettingsSchemaVersion', 1)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      agentModel: 'gpt-5.6-terra',
      agentReasoningEffort: 'high'
    })
    expect(repositories.settings.get('app.publicSettings')).toMatchObject({
      agentModel: 'gpt-5.6-terra',
      agentReasoningEffort: 'high'
    })
    expect(repositories.settings.get('app.publicSettingsSchemaVersion')).toBe(2)
  })

  it('normalizes a Codex model with an embedded reasoning suffix when saving', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    await expect(runtime.saveSettings({
      agentModel: 'gpt-5.6-terra-high'
    })).resolves.toMatchObject({
      agentModel: 'gpt-5.6-terra',
      agentReasoningEffort: 'high'
    })
  })

  it('defaults, saves and validates the configurable Feishu sync timing', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      feishuSyncRecentDays: 30,
      feishuRetentionDays: 30
    })
    expect(new AppRepositories(database.connection).settings.get('app.publicSettingsSchemaVersion')).toBe(2)
    await expect(runtime.saveSettings({ feishuSyncRecentDays: 7, feishuRetentionDays: 90 })).resolves.toMatchObject({
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 90
    })
    await expect(runtime.saveSettings({ feishuRetentionDays: 1 })).resolves.toMatchObject({
      feishuRetentionDays: 1
    })
    await expect(runtime.saveSettings({ feishuRetentionDays: 365 })).resolves.toMatchObject({
      feishuRetentionDays: 365
    })
    await expect(runtime.saveSettings({ feishuRetentionDays: 0 })).rejects.toThrow('INVALID_FEISHU_RETENTION_DAYS')
    await expect(runtime.saveSettings({ feishuRetentionDays: 365.5 })).rejects.toThrow('INVALID_FEISHU_RETENTION_DAYS')
    await expect(runtime.saveSettings({ feishuRetentionDays: 366 })).rejects.toThrow('INVALID_FEISHU_RETENTION_DAYS')
    await expect(runtime.saveSettings({ feishuSyncRecentDays: 0 })).rejects.toThrow('INVALID_FEISHU_SYNC_RECENT_DAYS')
    await expect(runtime.saveSettings({ feishuSyncRecentDays: 365.5 })).rejects.toThrow('INVALID_FEISHU_SYNC_RECENT_DAYS')
    await expect(runtime.saveSettings({ feishuSyncRecentDays: 366 })).rejects.toThrow('INVALID_FEISHU_SYNC_RECENT_DAYS')
  })

  it('uses the durable Feishu coordinator mode for settings reads and writes', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('feishu.syncState', 'damaged')
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getSettings()).resolves.toMatchObject({ feishuSyncMode: 'manual' })
    await expect(runtime.saveSettings({ feishuSyncMode: 'auto' })).resolves.toMatchObject({ feishuSyncMode: 'auto' })
    expect(repositories.settings.get('feishu.syncState')).toMatchObject({ mode: 'auto' })
    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('feishuSyncMode')
    await expect(runtime.saveSettings({ feishuSyncMode: 'scheduled' as never })).rejects.toThrow('INVALID_FEISHU_SYNC_MODE')
  })

  it('returns the exact recommended behavioral defaults for a fresh runtime', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      analysisRecentDays: 30,
      analysisMaxWorksPerCreator: 10,
      mediaRetentionDays: 7,
      feishuSyncRecentDays: 30,
      feishuRetentionDays: 30,
      feishuSyncMode: 'auto',
      agentModel: undefined,
      agentReasoningEffort: undefined,
      absoluteLikes: 10_000,
      relativePerformanceMultiplier: 3,
      relativePerformanceSurgeMultiplier: 80,
      highCollects: 3_000,
      highComments: 500,
      highShares: 500
    })
  })

  it('restores behavioral settings without deleting credentials, connections, or data', async () => {
    const repositories = new AppRepositories(database.connection)
    const saveApiKey = vi.fn()
    const connection = {
      status: 'connected' as const, baseName: 'Radar', baseUrl: 'https://example.feishu.cn/base/base-1',
      lastSyncedAt: '2026-08-09T00:00:00.000Z', message: '', customAppConfigured: true, maskedAppId: 'cli_***123'
    }
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), saveApiKey,
      feishu: {
        getConnection: () => connection,
        connectCustomApp: vi.fn(), repair: vi.fn(), recreate: vi.fn(), disconnect: vi.fn(), syncAll: vi.fn(), syncWork: vi.fn()
      }
    })
    repositories.creators.create({
      id: 'creator-preserved', platform: 'douyin', name: 'Preserved',
      profileUrl: 'https://www.douyin.com/user/preserved', enabled: true, createdAt: '2026-08-09T00:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-preserved', creatorId: 'creator-preserved', platformWorkId: 'preserved',
      sourceType: 'douyin_monitor', sourceKey: 'douyin:preserved', mediaPath: null, title: 'Preserved work',
      publishedAt: '2026-08-09T00:00:00.000Z', originalUrl: 'https://www.douyin.com/video/preserved', downloadUrl: null,
      metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
    })
    repositories.analyses.save({
      workId: 'work-preserved', transcript: 'preserved analysis', result: {}, provider: 'openai', model: 'gpt-test',
      promptVersion: 'test', tokenUsage: null, createdAt: '2026-08-09T00:00:00.000Z'
    })
    repositories.settings.set('feishu.connection', { appToken: 'base-1' })
    await runtime.saveSettings({
      apiKey: 'api-key-preserved', providerId: 'openai', modelId: 'gpt-test', customBaseUrl: 'https://api.example.com',
      agentModel: 'gpt-5.6-terra', agentReasoningEffort: 'high', runEngine: 'local-agent', agentCliPath: 'C:\\tools\\codex.cmd',
      analysisRecentDays: 90, analysisMaxWorksPerCreator: 1, mediaRetentionDays: 3,
      feishuSyncRecentDays: 7, feishuRetentionDays: 1, feishuSyncMode: 'manual',
      absoluteLikes: 1, relativePerformanceMultiplier: 9, relativePerformanceSurgeMultiplier: 99,
      highCollects: 1, highComments: 2, highShares: 3
    })

    await expect(runtime.restoreRecommendedBehaviorSettings()).resolves.toMatchObject({
      analysisRecentDays: 30,
      analysisMaxWorksPerCreator: 10,
      mediaRetentionDays: 7,
      feishuSyncRecentDays: 30,
      feishuRetentionDays: 30,
      feishuSyncMode: 'auto',
      absoluteLikes: 10_000,
      relativePerformanceMultiplier: 3,
      relativePerformanceSurgeMultiplier: 80,
      highCollects: 3_000,
      highComments: 500,
      highShares: 500,
      providerId: 'openai', modelId: 'gpt-test', customBaseUrl: 'https://api.example.com',
      runEngine: 'local-agent', agentCliPath: 'C:\\tools\\codex.cmd'
    })
    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('agentModel')
    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('agentReasoningEffort')
    expect(repositories.settings.get(FEISHU_SYNC_STATE_KEY)).toMatchObject({ mode: 'auto' })
    expect(repositories.settings.get('feishu.connection')).toEqual({ appToken: 'base-1' })
    expect(repositories.creators.getById('creator-preserved')).toMatchObject({ name: 'Preserved' })
    expect(repositories.works.get('work-preserved')).toMatchObject({ title: 'Preserved work' })
    expect(repositories.analyses.get('work-preserved')).toMatchObject({ transcript: 'preserved analysis' })
    expect(saveApiKey).toHaveBeenCalledOnce()
    expect(saveApiKey).toHaveBeenCalledWith('openai', 'api-key-preserved')
  })

  it('rolls back a recommended reset when the coordinator mode cannot persist', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    const repositories = (runtime as unknown as { repositories: AppRepositories }).repositories
    await runtime.saveSettings({ analysisRecentDays: 45, feishuSyncMode: 'manual' })
    const originalSet = repositories.settings.set.bind(repositories.settings)
    const set = vi.spyOn(repositories.settings, 'set').mockImplementation((key, value) => {
      if (key === FEISHU_SYNC_STATE_KEY) throw new Error('SETTINGS_WRITE_FAILED')
      originalSet(key, value)
    })

    await expect(runtime.restoreRecommendedBehaviorSettings()).rejects.toThrow('SETTINGS_WRITE_FAILED')
    set.mockRestore()

    await expect(runtime.getSettings()).resolves.toMatchObject({ analysisRecentDays: 45, feishuSyncMode: 'manual' })
  })

  it('migrates a legacy public Feishu mode only when coordinator state is absent', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('app.publicSettings', { feishuSyncMode: 'manual', analysisRecentDays: 45 })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('feishuSyncMode')
    await expect(runtime.getSettings()).resolves.toMatchObject({ feishuSyncMode: 'manual', analysisRecentDays: 45 })
    expect(repositories.settings.get(FEISHU_SYNC_STATE_KEY)).toMatchObject({ mode: 'manual' })
    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('feishuSyncMode')
  })

  it('keeps damaged coordinator recovery manual instead of applying a legacy automatic mode', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('app.publicSettings', { feishuSyncMode: 'auto' })
    repositories.settings.set(FEISHU_SYNC_STATE_KEY, 'damaged')
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('feishuSyncMode')
    await expect(runtime.getSettings()).resolves.toMatchObject({ feishuSyncMode: 'manual' })
    expect(repositories.settings.get(FEISHU_SYNC_STATE_KEY)).toMatchObject({ mode: 'manual' })
    expect(repositories.settings.get('app.publicSettings')).not.toHaveProperty('feishuSyncMode')
  })

  it('rolls back public settings when persisting the coordinator mode fails', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    const repositories = (runtime as unknown as { repositories: AppRepositories }).repositories
    await runtime.saveSettings({ analysisRecentDays: 30 })
    const originalSet = repositories.settings.set.bind(repositories.settings)
    const set = vi.spyOn(repositories.settings, 'set').mockImplementation((key, value) => {
      if (key === FEISHU_SYNC_STATE_KEY) throw new Error('SETTINGS_WRITE_FAILED')
      originalSet(key, value)
    })

    await expect(runtime.saveSettings({ analysisRecentDays: 45, feishuSyncMode: 'manual' }))
      .rejects.toThrow('SETTINGS_WRITE_FAILED')
    set.mockRestore()

    await expect(runtime.getSettings()).resolves.toMatchObject({ analysisRecentDays: 30, feishuSyncMode: 'auto' })
  })

  it('migrates the legacy 30x relative-performance default to 3x', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.settings.set('app.publicSettings', {
      relativePerformanceMultiplier: 30
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn()
    })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      relativePerformanceMultiplier: 3
    })
    expect(repositories.settings.get('app.publicSettings')).toMatchObject({
      relativePerformanceMultiplier: 3
    })
    expect(repositories.settings.get('app.publicSettingsSchemaVersion')).toBe(2)

    await runtime.saveSettings({ relativePerformanceMultiplier: 30 })

    await expect(runtime.getSettings()).resolves.toMatchObject({
      relativePerformanceMultiplier: 30
    })
  })

  it('shows an active keyless model as configured on the dashboard', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      isModelConfigured: () => true,
      getActiveModelIdentity: () => ({ profileId: 'local-profile', providerId: 'custom', modelId: 'local-model' })
    })

    const aiService = (await runtime.getDashboard()).services.find((service) => service.id === 'ai')

    expect(aiService).toMatchObject({ status: 'healthy', detail: '模型已配置' })
  })

  it('shows detected local Codex as ready on the dashboard', async () => {
    const detectAgentCli = vi.fn().mockResolvedValue({
      id: 'codex', command: 'C:\\codex.cmd', displayName: 'Codex'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      runAgentAnalysis: vi.fn(), detectAgentCli
    })
    await runtime.saveSettings({ runEngine: 'local-agent' })

    const aiService = (await runtime.getDashboard()).services.find((service) => service.id === 'ai')

    expect(detectAgentCli).toHaveBeenCalled()
    expect(aiService).toMatchObject({
      status: 'healthy', detail: '本地 Codex 已就绪', actionLabel: undefined
    })
  })

  it('does not treat legacy public settings as an active production model', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      isModelConfigured: () => false,
      getActiveModelIdentity: () => null
    })
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'legacy-model' })

    const aiService = (await runtime.getDashboard()).services.find((service) => service.id === 'ai')

    expect(aiService).toMatchObject({ status: 'action_required', detail: '尚未配置' })
  })

  it('stores the active model identity in the weekly topic cache', async () => {
    const clusterWeeklyTopics = vi.fn(async () => ({
      categories: [{ name: 'Topic', workIds: ['work-a', 'work-b', 'work-c'] }]
    }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), clusterWeeklyTopics,
      isModelConfigured: () => true,
      getActiveModelIdentity: () => ({ profileId: 'local-profile', providerId: 'custom', modelId: 'local-model' })
    })
    const getWeeklyTopicRanking = runtime as unknown as {
      getWeeklyTopicRanking(highlights: Array<Record<string, unknown>>, weekStart: string, settings: Record<string, unknown>): Promise<unknown>
    }

    await getWeeklyTopicRanking.getWeeklyTopicRanking([
      { id: 'work-a', title: 'A', likes: 10, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-b', title: 'B', likes: 9, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-c', title: 'C', likes: 8, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } }
    ], '2026-08-03T00:00:00.000Z', {
      providerId: 'deepseek', modelId: 'legacy-model', apiKeyConfiguredByProvider: { deepseek: true }
    })

    expect(new AppRepositories(database.connection).settings.get('dashboard.weeklyTopicClustering')).toMatchObject({
      profileId: 'local-profile', providerId: 'custom', modelId: 'local-model'
    })
  })

  it('uses local Codex for weekly topic clustering without a cloud model', async () => {
    const clusterWeeklyTopics = vi.fn(async () => ({
      categories: [{ name: '本地选题', workIds: ['work-a', 'work-b', 'work-c'] }]
    }))
    const detectAgentCli = vi.fn(async () => ({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: () => ['exec']
    }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), clusterWeeklyTopics,
      runAgentAnalysis: vi.fn(), detectAgentCli,
      isModelConfigured: () => false,
      getActiveModelIdentity: () => null
    })
    const getWeeklyTopicRanking = runtime as unknown as {
      getWeeklyTopicRanking(highlights: Array<Record<string, unknown>>, weekStart: string, settings: Record<string, unknown>): Promise<{
        state: string
        ranking: Array<{ topic: string }>
      }>
    }
    const settings = {
      runEngine: 'local-agent', agentModel: 'gpt-5.6-luna', agentReasoningEffort: 'max'
    }

    const result = await getWeeklyTopicRanking.getWeeklyTopicRanking([
      { id: 'work-a', title: 'A', likes: 10, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-b', title: 'B', likes: 9, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-c', title: 'C', likes: 8, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } }
    ], '2026-08-03T00:00:00.000Z', settings)

    expect(result).toMatchObject({ state: 'ready', ranking: [{ topic: '本地选题' }] })
    expect(clusterWeeklyTopics).toHaveBeenCalledWith(expect.any(Array), settings)
    expect(new AppRepositories(database.connection).settings.get('dashboard.weeklyTopicClustering')).toMatchObject({
      providerId: 'local-agent', modelId: 'gpt-5.6-luna@max'
    })
  })

  it('isolates in-flight weekly clustering and cache writes by active profile', async () => {
    let activeIdentity = { profileId: 'profile-a', providerId: 'deepseek', modelId: 'model-a' }
    let resolveA!: (value: { categories: Array<{ name: string, workIds: string[] }> }) => void
    let resolveB!: (value: { categories: Array<{ name: string, workIds: string[] }> }) => void
    const pendingA = new Promise<{ categories: Array<{ name: string, workIds: string[] }> }>((resolve) => { resolveA = resolve })
    const pendingB = new Promise<{ categories: Array<{ name: string, workIds: string[] }> }>((resolve) => { resolveB = resolve })
    const clusterWeeklyTopics = vi.fn()
      .mockReturnValueOnce(pendingA)
      .mockReturnValueOnce(pendingB)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), clusterWeeklyTopics,
      isModelConfigured: () => true,
      getActiveModelIdentity: () => activeIdentity
    })
    const getWeeklyTopicRanking = runtime as unknown as {
      getWeeklyTopicRanking(highlights: Array<Record<string, unknown>>, weekStart: string, settings: Record<string, unknown>): Promise<unknown>
    }
    const highlights = [
      { id: 'work-a', title: 'A', likes: 10, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-b', title: 'B', likes: 9, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-c', title: 'C', likes: 8, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } }
    ]
    const settings = { providerId: 'deepseek', modelId: 'legacy-model', apiKeyConfiguredByProvider: { deepseek: true } }

    const first = getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)
    await Promise.resolve()
    activeIdentity = { profileId: 'profile-b', providerId: 'deepseek', modelId: 'model-b' }
    const second = getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)

    expect(clusterWeeklyTopics).toHaveBeenCalledTimes(2)
    resolveB({ categories: [{ name: 'B topic', workIds: ['work-a', 'work-b', 'work-c'] }] })
    await second
    expect(new AppRepositories(database.connection).settings.get('dashboard.weeklyTopicClustering')).toMatchObject({
      profileId: 'profile-b', modelId: 'model-b'
    })

    resolveA({ categories: [{ name: 'A topic', workIds: ['work-a', 'work-b', 'work-c'] }] })
    await first
    expect(new AppRepositories(database.connection).settings.get('dashboard.weeklyTopicClustering')).toMatchObject({
      profileId: 'profile-b', modelId: 'model-b'
    })

    await getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)
    expect(clusterWeeklyTopics).toHaveBeenCalledTimes(2)
  })

  it('keeps profile B in flight when profile A finishes first', async () => {
    let activeIdentity = { profileId: 'profile-a', providerId: 'deepseek', modelId: 'model-a' }
    let resolveA!: (value: { categories: Array<{ name: string, workIds: string[] }> }) => void
    let resolveB!: (value: { categories: Array<{ name: string, workIds: string[] }> }) => void
    const pendingA = new Promise<{ categories: Array<{ name: string, workIds: string[] }> }>((resolve) => { resolveA = resolve })
    const pendingB = new Promise<{ categories: Array<{ name: string, workIds: string[] }> }>((resolve) => { resolveB = resolve })
    const clusterWeeklyTopics = vi.fn().mockReturnValueOnce(pendingA).mockReturnValueOnce(pendingB)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), clusterWeeklyTopics,
      isModelConfigured: () => true,
      getActiveModelIdentity: () => activeIdentity
    })
    const getWeeklyTopicRanking = runtime as unknown as {
      getWeeklyTopicRanking(highlights: Array<Record<string, unknown>>, weekStart: string, settings: Record<string, unknown>): Promise<unknown>
    }
    const highlights = [
      { id: 'work-a', title: 'A', likes: 10, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-b', title: 'B', likes: 9, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } },
      { id: 'work-c', title: 'C', likes: 8, firstBecameViralAt: null, analysis: { topicAngle: '', viralPoints: [] } }
    ]
    const settings = { providerId: 'deepseek', modelId: 'legacy-model', apiKeyConfiguredByProvider: { deepseek: true } }

    const first = getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)
    await Promise.resolve()
    activeIdentity = { profileId: 'profile-b', providerId: 'deepseek', modelId: 'model-b' }
    const second = getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)
    resolveA({ categories: [{ name: 'A topic', workIds: ['work-a', 'work-b', 'work-c'] }] })
    await first

    const refresh = getWeeklyTopicRanking.getWeeklyTopicRanking(highlights, '2026-08-03T00:00:00.000Z', settings)
    expect(clusterWeeklyTopics).toHaveBeenCalledTimes(2)
    resolveB({ categories: [{ name: 'B topic', workIds: ['work-a', 'work-b', 'work-c'] }] })
    await Promise.all([second, refresh])
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

  it('upgrades an existing creator to my account when the same profile is added as mine', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockResolvedValue([]), processWork: vi.fn(), login: vi.fn()
    })
    const first = await runtime.addCreator('https://www.douyin.com/user/my-profile')

    const mine = await runtime.addCreator({
      url: 'https://www.douyin.com/user/my-profile',
      ownership: 'mine'
    })

    expect(mine.id).toBe(first.id)
    expect(new AppRepositories(database.connection).creators.getById(first.id)).toMatchObject({ ownership: 'mine' })
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

  it('captures only the newly added creator during its first background capture', async () => {
    vi.useFakeTimers()
    try {
      const repositories = new AppRepositories(database.connection)
      repositories.creators.create({
        id: 'existing-creator', platform: 'douyin', name: 'Existing', enabled: true,
        profileUrl: 'https://www.douyin.com/user/existing-creator', createdAt: new Date().toISOString()
      })
      const discover = vi.fn().mockResolvedValue([])
      const runtime = new DesktopRuntime(database, {
        discover, processWork: vi.fn(), login: vi.fn()
      })

      const added = await runtime.addCreator('https://www.douyin.com/user/new-creator')
      await vi.runAllTimersAsync()

      expect(discover).toHaveBeenCalledTimes(1)
      expect(discover).toHaveBeenCalledWith(added.id, added.profileUrl)
      expect(discover).not.toHaveBeenCalledWith(
        'existing-creator',
        'https://www.douyin.com/user/existing-creator'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures an added personal account as my works', async () => {
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn()
    })

    const creator = await runtime.addCreator({
      url: 'https://www.douyin.com/user/mine',
      ownership: 'mine'
    })

    expect(creator.name).toBe('我的账号')
    expect(new AppRepositories(database.connection).creators.getById(creator.id)).toMatchObject({ ownership: 'mine' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl, 'mine')
  })

  it('automatically captures a newly added creator after the active run finishes', async () => {
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
    expect(report).not.toHaveBeenCalledWith('info', 'First capture deferred', expect.anything())

    finishDiscovery([])
    await vi.waitFor(() => expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl))
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('records a first-capture startup failure without rejecting creator creation', async () => {
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report
    })
    vi.spyOn(runtime as unknown as { runCreators: () => Promise<unknown> }, 'runCreators')
      .mockRejectedValueOnce(new Error('startup failed'))

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
    vi.spyOn(runtime as unknown as { runCreators: () => Promise<unknown> }, 'runCreators')
      .mockRejectedValueOnce(new Error('private path C:\\secret'))

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

  it('reports every coalesced creator when the first capture is deferred', async () => {
    vi.useFakeTimers()
    try {
      const report = vi.fn()
      const runtime = new DesktopRuntime(database, {
        discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report
      })
      vi.spyOn(runtime as unknown as { runCreators: () => Promise<{ accepted: boolean; reason?: string }> }, 'runCreators')
        .mockResolvedValueOnce({ accepted: false, reason: '已有任务正在运行' })

      const first = await runtime.addCreator('https://www.douyin.com/user/deferred-first')
      const second = await runtime.addCreator('https://www.douyin.com/user/deferred-second')
      await vi.runAllTimersAsync()

      expect(report).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledWith('info', 'First capture deferred', {
        code: 'FIRST_CAPTURE_DEFERRED', creatorId: first.id, reason: '已有任务正在运行'
      })
      expect(report).toHaveBeenCalledWith('info', 'First capture deferred', {
        code: 'FIRST_CAPTURE_DEFERRED', creatorId: second.id, reason: '已有任务正在运行'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports every coalesced creator without exposing a first-capture startup error', async () => {
    vi.useFakeTimers()
    try {
      const report = vi.fn()
      const runtime = new DesktopRuntime(database, {
        discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), report
      })
      vi.spyOn(runtime as unknown as { runCreators: () => Promise<unknown> }, 'runCreators')
        .mockRejectedValueOnce(new Error('private path C:\\secret'))

      const first = await runtime.addCreator('https://www.douyin.com/user/rejected-first')
      const second = await runtime.addCreator('https://www.douyin.com/user/rejected-second')
      await vi.runAllTimersAsync()

      expect(report).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledWith('error', 'First capture start failed', {
        code: 'FIRST_CAPTURE_START_FAILED', creatorId: first.id
      })
      expect(report).toHaveBeenCalledWith('error', 'First capture start failed', {
        code: 'FIRST_CAPTURE_START_FAILED', creatorId: second.id
      })
      expect(JSON.stringify(report.mock.calls)).not.toContain('private path C:\\secret')
    } finally {
      vi.useRealTimers()
    }
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

  it('does not start discovery when the Douyin session is not logged in', async () => {
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(),
      isLoggedIn: vi.fn().mockResolvedValue(false),
      closeBrowser: vi.fn().mockResolvedValue(undefined)
    })
    await runtime.addCreator('https://www.douyin.com/user/login-required')

    await expect(runtime.runNow()).resolves.toEqual({
      accepted: false,
      reason: '抖音登录已失效，请重新登录。'
    })
    expect(discover).not.toHaveBeenCalled()
    expect(runtime.isBusinessIdle()).toBe(true)
  })

  it('does not start discovery when the Douyin login state cannot be confirmed', async () => {
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(),
      isLoggedIn: vi.fn().mockRejectedValue(new Error('probe unavailable')),
      closeBrowser: vi.fn().mockResolvedValue(undefined)
    })
    await runtime.addCreator('https://www.douyin.com/user/login-unknown')

    await expect(runtime.runNow()).resolves.toEqual({
      accepted: false,
      reason: '无法确认抖音登录状态，请稍后重试。'
    })
    expect(discover).not.toHaveBeenCalled()
    expect(runtime.isBusinessIdle()).toBe(true)
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

  it('uses Scrapling discovery even when the saved source is Get Biji', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-1', platform: 'douyin', name: '林克AI实战录',
      profileUrl: 'https://www.douyin.com/user/example', enabled: true,
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    repositories.creators.create({
      id: 'getbiji:f-1', platform: 'douyin', name: '旧数据',
      profileUrl: 'getbiji://blogger/f-1', enabled: true,
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    const discover = vi.fn(async () => [])
    const discoverFromGetBiji = vi.fn(async () => [])
    const syncCreators = vi.fn(async () => [])
    const runtime = new DesktopRuntime(database, {
      discover, discoverFromGetBiji, syncCreators, processWork: vi.fn(), login: vi.fn()
    })
    await runtime.saveSettings({ contentSource: 'get_biji' })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith('creator-1', 'https://www.douyin.com/user/example')
    expect(discoverFromGetBiji).not.toHaveBeenCalled()
    expect(syncCreators).not.toHaveBeenCalled()
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
      status: 'completed', requiresAction: false
    })
  })

  it('writes real creator metadata returned by discovery without replacing creator state', async () => {
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-metadata', platform: 'douyin', name: '@MS4wLjABAAAA',
      profileUrl: 'https://www.douyin.com/user/original', enabled: true,
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async () => ({
        creator: { name: '林克AI实战录', profileUrl: 'https://www.douyin.com/user/resolved' },
        works: []
      })),
      processWork: vi.fn(),
      login: vi.fn()
    })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(repositories.creators.getById(creator.id)).toEqual({
      ...creator,
      name: '林克AI实战录',
      profileUrl: 'https://www.douyin.com/user/resolved'
    })
  })

  it('does not replace creator metadata with the generic Scrapling placeholder', async () => {
    const repositories = new AppRepositories(database.connection)
    const creator = repositories.creators.create({
      id: 'creator-generic', platform: 'douyin', name: '已有昵称',
      profileUrl: 'https://www.douyin.com/user/existing', enabled: true,
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async () => ({
        creator: { name: '抖音博主', profileUrl: 'https://www.douyin.com/user/placeholder' },
        works: []
      })),
      processWork: vi.fn(),
      login: vi.fn()
    })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(repositories.creators.getById(creator.id)).toEqual(creator)
  })

  it('clears unclassified works and only requests managed media cleanup', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({
      id: 'manual-1', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'local:manual-1', mediaPath: 'C:\\managed\\manual-1\\video.mp4',
      title: '手动作品', publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const removeManagedMedia = vi.fn(async () => undefined)
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(), removeManagedMedia
    })

    await runtime.clearUnclassifiedWorks()

    expect(repositories.works.listAll()).toEqual([])
    expect(removeManagedMedia).toHaveBeenCalledWith(['manual-1'])
  })

  it('continues after one work analysis fails', async () => {
    const now = new Date().toISOString()
    const discover = vi.fn(async (creatorId: string) => ['first', 'second'].map((id) => ({
      id, creatorId, platformWorkId: id, title: id, publishedAt: now,
      originalUrl: `https://www.douyin.com/video/${id}`, sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${id}`, mediaPath: null, downloadUrl: null,
      metrics: { likes: 12000, comments: 0, shares: 0, collects: 0 }
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

  it('applies analysis limits after excluding works already analysed and reports real counts', async () => {
    const now = Date.now()
    const makeWork = (id: string, daysAgo: number) => ({
      id, creatorId: 'creator-limits', platformWorkId: id, title: id,
      publishedAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      originalUrl: `https://www.douyin.com/video/${id}`, sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${id}`, mediaPath: null, downloadUrl: null,
      metrics: { likes: 12000, comments: 0, shares: 0, collects: 0 }
    })
    const works = [makeWork('analysed', 0), makeWork('next', 1), makeWork('last', 2), makeWork('outside', 31)]
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-limits', platform: 'douyin', name: 'Limits', enabled: true,
      profileUrl: 'https://www.douyin.com/user/limits', createdAt: new Date().toISOString()
    })
    repositories.works.upsert(works[0])
    repositories.analyses.save({
      workId: 'analysed', transcript: 'existing', result: {}, provider: 'qwen', model: 'model',
      promptVersion: 'v1', tokenUsage: null, createdAt: new Date().toISOString()
    })
    const processWork = vi.fn(async (work: Work) => ({
      transcript: work.id, result: {}, provider: 'qwen', model: 'model',
      promptVersion: 'v1', tokenUsage: null
    }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async () => works), processWork, login: vi.fn()
    })
    await runtime.saveSettings({
      providerId: 'qwen', modelId: 'model', analysisMaxWorksPerCreator: 2, analysisRecentDays: 30
    })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork.mock.calls.map(([work]) => work.id)).toEqual(['next', 'last'])
    expect((await runtime.listRuns())[0]).toMatchObject({
      discovered: 4, selectedForAnalysis: 2, analyzed: 2
    })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).toHaveBeenCalledTimes(2)
    expect((await runtime.listRuns())[0]).toMatchObject({ selectedForAnalysis: 0, analyzed: 0 })
    expect((await runtime.getDashboard()).run).toMatchObject({
      message: expect.stringContaining('本次未执行 AI 拆解')
    })
    expect((await runtime.getDashboard()).run.stages.find((stage) => stage.id === 'analysis')?.status)
      .toBe('pending')
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
      metrics: { likes: 12000, comments: 0, shares: 0, collects: 0 }
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
    expect(new AppRepositories(database.connection).runs.latestFinished()?.summary).toMatchObject({
      failures: [expect.objectContaining({
        creatorName: expect.any(String),
        stage: 'discovery',
        code: 'DOUYIN_CREATOR_COLLECTION_FAILED',
        message: '博主作品采集失败，请稍后重试。'
      })]
    })
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
  })

  it('uses the newest completed run for lastRunAt regardless of legacy run kind', async () => {
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

  it('keeps a canonical dashboard failure when the terminal run record cannot be saved', async () => {
    database.connection.exec(`
      CREATE TRIGGER fail_snapshot_before_persistence
      BEFORE INSERT ON metric_snapshots BEGIN SELECT RAISE(FAIL, 'Bearer secret snapshot'); END;
      CREATE TRIGGER fail_terminal_run_save
      BEFORE UPDATE ON runs WHEN NEW.status = 'failed' BEGIN SELECT RAISE(FAIL, 'C:\\private run'); END;
    `)
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async (creatorId: string) => [{
        id: 'persistence-fatal-work', creatorId, platformWorkId: 'persistence-fatal', title: 'Fatal',
        publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
        sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:persistence-fatal', mediaPath: null,
        metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
      }]),
      processWork: vi.fn(), login: vi.fn(), report
    })
    await runtime.addCreator('https://www.douyin.com/user/persistence-fatal')

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'failed', requiresAction: true,
      failures: [expect.objectContaining({ code: 'UNKNOWN_FAILURE', stage: 'discovery' })]
    })
    expect(report).toHaveBeenCalledWith('error', '运行状态保存失败', expect.objectContaining({ code: 'RUN_STATE_PERSISTENCE_FAILED' }))
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/Bearer|private|secret/)
  })

  it('does not misclassify a final run-record save failure as a Feishu failure', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-final-save', platform: 'douyin', name: 'Final save', enabled: true,
      profileUrl: 'https://www.douyin.com/user/final-save', createdAt: new Date().toISOString()
    })
    database.connection.exec(`
      CREATE TRIGGER fail_final_completed_run_save
      BEFORE UPDATE ON runs WHEN NEW.status = 'completed' BEGIN SELECT RAISE(FAIL, 'C:\\private final save'); END;
    `)
    const runtime = new DesktopRuntime(database, { discover: vi.fn().mockResolvedValue([]), processWork: vi.fn(), login: vi.fn() })

    await runtime.runNow('daily')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'failed',
      failures: [expect.objectContaining({ stage: 'discovery', code: 'UNKNOWN_FAILURE' })]
    })
    expect((await runtime.getDashboard()).run.failures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEISHU_SYNC_FAILED' })
    ]))
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

    expect(runtime.isBusinessIdle()).toBe(false)
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
    const diagnostic = { exceptionType: 'TargetClosedError', errorMessage: 'Browser context closed' }
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn().mockRejectedValue(Object.assign(new Error('采集失败'), { diagnostic })),
      processWork: vi.fn(), login: vi.fn(), report
    })
    await runtime.addCreator('https://www.douyin.com/user/log-check')
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await runtime.runNow()
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(report).toHaveBeenCalledWith('error', '博主采集失败', expect.objectContaining({
      creatorId: expect.any(String), code: 'DOUYIN_CREATOR_COLLECTION_FAILED', stage: 'discovery'
    }))
    expect(report).toHaveBeenCalledWith('info', '开始采集博主', { creatorId: expect.any(String) })
    expect(JSON.stringify(report.mock.calls)).not.toContain('Browser context closed')
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
      expect.objectContaining({ id: 'monitor-1', creatorId: 'creator-1', creatorName: 'Alice', status: 'completed', stage: 'completed', likes: 12 })
    ])
  })

  it('returns a typed work detail assembled from persisted relations', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-1', platform: 'douyin', name: 'Alice', profileUrl: 'https://www.douyin.com/user/alice', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' })
    repositories.works.upsert({ id: 'detail-1', creatorId: 'creator-1', platformWorkId: '1', sourceType: 'douyin_monitor', sourceKey: 'douyin:detail-1', mediaPath: null, title: 'Detail', publishedAt: '2026-01-02T00:00:00.000Z', originalUrl: 'https://www.douyin.com/video/detail-1', downloadUrl: null, metrics: { likes: 12000, comments: 34, shares: 56, collects: 78 } })
    const result = {
      topicAngle: 'angle', openingHook: { quote: 'quote', type: 'type', mechanism: 'mechanism' },
      structure: ['one'], viralPoints: ['point'], highlights: ['highlight'],
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
        structure: ['one'], viralPoints: ['point'], highlights: ['highlight'],
        reusablePatterns: ['pattern'], differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
      }, analysisProvider: 'deepseek', analyzedAt: '2026-01-03T00:00:00.000Z'
    }))
  })

  it('keeps analysis metadata and fills missing fields for malformed persisted analysis', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({ id: 'malformed-1', creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: 'sha256:malformed', mediaPath: 'malformed.mp4', title: 'Malformed', publishedAt: '2026-01-02T00:00:00.000Z', originalUrl: null, downloadUrl: null, metrics: { likes: 0, comments: 0, shares: 0, collects: 0 } })
    repositories.analyses.save({ workId: 'malformed-1', transcript: 'safe transcript', result: { topicAngle: 42 }, provider: 'qwen', model: 'chat', promptVersion: 'v1', tokenUsage: null, createdAt: '2026-01-03T00:00:00.000Z' })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.getWork('malformed-1')).resolves.toEqual(expect.objectContaining({
      transcript: 'safe transcript',
      analysisProvider: 'qwen',
      analyzedAt: '2026-01-03T00:00:00.000Z',
      analysis: expect.objectContaining({
        topicAngle: '',
        openingHook: { quote: '', type: '', mechanism: '' },
        structure: [],
        viralPoints: [],
        highlights: [],
        reusablePatterns: [],
        differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
      })
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
      downloadUrl: null, metrics: { likes: 12000, comments: 2, shares: 3, collects: 4 }
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

    expect(listener.mock.calls).toEqual([['monitored-1'], ['monitored-1'], ['monitored-1']])
    expect(persistedStates).toEqual([false, false, true])
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
    const imports = { isRetryable: vi.fn(() => false) } as unknown as ImportService
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() }, imports)
    await runtime.getSettings()
    const prepare = vi.spyOn(database.connection, 'prepare')

    await expect(runtime.listWorks()).resolves.toHaveLength(4)
    const baselineQueryCount = prepare.mock.calls.length
    prepare.mockClear()
    for (let index = 4; index < 8; index += 1) {
      repositories.works.upsert({ id: `work-${index}`, creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: `sha256:${index}`, mediaPath: `${index}.mp4`, title: `Work ${index}`, publishedAt: `2026-01-0${index + 1}T00:00:00.000Z`, originalUrl: null, downloadUrl: null, metrics: { likes: index, comments: 0, shares: 0, collects: 0 } })
      repositories.jobs.save({ workId: `work-${index}`, stage: 'completed', status: 'completed', attemptCount: 1, nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: '2026-01-01T00:00:00.000Z' })
    }
    prepare.mockClear()
    await expect(runtime.listWorks()).resolves.toHaveLength(8)
    expect(prepare).toHaveBeenCalledTimes(baselineQueryCount)
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

  it('recovers interrupted runs on startup so they no longer remain permanently running', () => {
    const repositories = new AppRepositories(database.connection)
    repositories.runs.save({
      id: 'interrupted-run', kind: 'manual', status: 'running',
      startedAt: '2026-07-18T10:00:00.000Z', finishedAt: null, summary: { discovered: 12 }
    })

    new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })

    expect(repositories.runs.get('interrupted-run')).toMatchObject({
      status: 'failed',
      finishedAt: expect.any(String),
      summary: expect.objectContaining({ error: 'APP_INTERRUPTED' })
    })
  })

  it('shows the live processing stage for a manually analyzed work', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({
      id: 'long-video', creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: 'long-video',
      mediaPath: 'long.mp4', title: 'Long video', publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    let finish!: () => void
    const processWork = vi.fn(async (_work: Work, _settings, onProgress) => {
      onProgress?.({ stage: 'audio_extracted', label: '正在转写第 2/6 段' })
      await new Promise<void>((resolve) => { finish = resolve })
      return { transcript: 'done', result: {}, provider: 'deepseek', model: 'chat', promptVersion: 'v1', tokenUsage: null }
    })
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork, login: vi.fn() })
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await expect(runtime.analyzeWork('long-video')).resolves.toEqual({ accepted: true })
    await vi.waitFor(async () => expect((await runtime.getWork('long-video'))?.progressLabel).toBe('正在转写第 2/6 段'))

    finish()
    await vi.waitFor(async () => expect((await runtime.getWork('long-video'))?.status).toBe('completed'))
  })

  it('allows a failed work to be manually retried again without a cumulative limit', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.works.upsert({
      id: 'repeat-analysis', creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey: 'repeat-analysis',
      mediaPath: 'repeat.mp4', title: 'Repeat analysis', publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const processWork = vi.fn().mockRejectedValue(Object.assign(new Error('AI_ANALYSIS_INVALID'), { code: 'AI_ANALYSIS_INVALID' }))
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork, login: vi.fn() })
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await expect(runtime.analyzeWork('repeat-analysis')).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await expect(runtime.analyzeWork('repeat-analysis')).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).toHaveBeenCalledTimes(2)
    await expect(runtime.getWork('repeat-analysis')).resolves.toMatchObject({ status: 'failed', canAnalyzeManually: true })
  })

  it('does not automatically retry work recovered from an interrupted application session', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-1', platform: 'douyin', name: 'Creator', profileUrl: 'https://www.douyin.com/user/creator-1', enabled: true,
      createdAt: '2026-07-01T00:00:00.000Z'
    })
    const work: Work = {
      id: 'interrupted-work', creatorId: 'creator-1', platformWorkId: '1', sourceType: 'douyin_monitor', sourceKey: 'douyin:1',
      mediaPath: null, title: 'Recovered work', publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/1',
      downloadUrl: 'https://example.test/video.mp4', metrics: { likes: 12_000, comments: 0, shares: 0, collects: 0 }
    }
    repositories.works.upsert(work)
    repositories.jobs.save({
      workId: work.id, stage: 'audio_extracted', status: 'failed', attemptCount: 1, nextAttemptAt: null,
      errorCode: 'APP_INTERRUPTED', errorMessage: 'Application exited.', updatedAt: '2026-07-18T10:00:00.000Z'
    })
    const processWork = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(async () => [work]), processWork, login: vi.fn()
    })
    await runtime.saveSettings({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    await runtime.runNow('manual')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).not.toHaveBeenCalled()
    await expect(runtime.getWork(work.id)).resolves.toMatchObject({ status: 'failed', errorCode: 'APP_INTERRUPTED', canAnalyzeManually: true })
  })

  it('runs the local Agent engine when 立即运行 selects runEngine=local-agent', async () => {
    const work: Work = {
      id: 'douyin:agent-1', creatorId: '', platformWorkId: 'agent-1', title: 'Agent 作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/agent-1',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:agent-1', mediaPath: null,
      downloadUrl: 'https://video.example/agent-1.mp4',
      metrics: { likes: 12000, comments: 100, shares: 20, collects: 30 }
    }
    const discover = vi.fn(async (creatorId: string) => [{ ...work, creatorId }])
    const processWork = vi.fn(async () => ({ transcript: '', provider: 'qwen', model: 'q', promptVersion: 'v1', result: {}, tokenUsage: { input: 0, output: 0 } }))
    const runAgentAnalysis = vi.fn(async () => undefined)
    const detectAgentCli = vi.fn(async () => ({ id: 'codex', command: 'codex', displayName: 'Codex', execArgs: () => ['exec'] }))
    const runtime = new DesktopRuntime(database, {
      discover, processWork, login: vi.fn(), runAgentAnalysis, detectAgentCli
    })
    await runtime.addCreator('https://www.douyin.com/user/first')
    await runtime.saveSettings({ runEngine: 'local-agent', agentCliPath: 'codex' })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).not.toHaveBeenCalled()
    expect(runAgentAnalysis).toHaveBeenCalledTimes(1)
  })

  it('runs the local Codex engine for manual analysis without a cloud model', async () => {
    const work: Work = {
      id: 'douyin:manual-agent', creatorId: 'creator-manual-agent', platformWorkId: 'manual-agent', title: '手动 Codex 作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/manual-agent',
      sourceType: 'douyin_monitor', sourceKey: 'douyin:manual-agent', mediaPath: null, downloadUrl: null,
      metrics: { likes: 100, comments: 0, shares: 0, collects: 0 }
    }
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-manual-agent', platform: 'douyin', name: '手动测试', enabled: true,
      profileUrl: 'https://www.douyin.com/user/manual-agent', createdAt: new Date().toISOString()
    })
    repositories.works.upsert(work)
    const processWork = vi.fn()
    const runAgentAnalysis = vi.fn(async () => undefined)
    const detectAgentCli = vi.fn(async () => ({ id: 'codex', command: 'codex', displayName: 'Codex', execArgs: () => ['exec'] }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork, login: vi.fn(), runAgentAnalysis, detectAgentCli
    })
    await runtime.saveSettings({ runEngine: 'local-agent' })

    await expect(runtime.analyzeWork(work.id)).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(detectAgentCli).toHaveBeenCalledOnce()
    expect(runAgentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ id: work.id }), expect.objectContaining({ runEngine: 'local-agent' }))
    expect(processWork).not.toHaveBeenCalled()
  })

  it('skips analysis when the local Agent engine has no CLI configured', async () => {
    const work: Work = {
      id: 'douyin:agent-2', creatorId: '', platformWorkId: 'agent-2', title: '无 CLI',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/agent-2',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:agent-2', mediaPath: null,
      downloadUrl: 'https://video.example/agent-2.mp4',
      metrics: { likes: 12000, comments: 100, shares: 20, collects: 30 }
    }
    const discover = vi.fn(async (creatorId: string) => [{ ...work, creatorId }])
    const processWork = vi.fn()
    const detectAgentCli = vi.fn(async () => null)
    const runtime = new DesktopRuntime(database, {
      discover, processWork, login: vi.fn(), detectAgentCli, runAgentAnalysis: vi.fn()
    })
    await runtime.addCreator('https://www.douyin.com/user/first')
    await runtime.saveSettings({ runEngine: 'local-agent' })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(processWork).not.toHaveBeenCalled()
  })

  it('routes rewriteWork to the Agent when runEngine=local-agent, else cloud', async () => {
    const agentRewrite = vi.fn(async () => ({ needMore: false, questions: [], content: 'agent 版本', score: { directness: 8, rhythm: 8, trust: 8, authenticity: 8, refinement: 8, total: 40 } }))
    const cloudRewrite = vi.fn(async () => ({ needMore: false, questions: [], content: '云端版本', score: { directness: 9, rhythm: 9, trust: 9, authenticity: 9, refinement: 9, total: 45 } }))
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      agentRewrite, rewriteWork: cloudRewrite
    })
    const payload = {
      title: '标题', topicAngle: '角度', openingHookQuote: '钩子', openingHookType: '类型',
      openingHookMechanism: '机制', structure: '结构', viralPoints: '爆点',
      highlights: [], reusablePatterns: [], userContext: '背景', wordCount: 300
    }

    await runtime.saveSettings({ runEngine: 'local-agent' })
    const agentOut = await runtime.rewriteWork('w1', payload)
    expect(agentRewrite).toHaveBeenCalledWith('w1', payload, expect.objectContaining({ runEngine: 'local-agent' }))
    expect(agentOut.content).toBe('agent 版本')

    await runtime.saveSettings({ runEngine: 'cloud' })
    const cloudOut = await runtime.rewriteWork('w1', payload)
    expect(cloudRewrite).toHaveBeenCalledWith('w1', payload)
    expect(cloudOut.content).toBe('云端版本')
  })

  it('fills missing reusable patterns for legacy analyses in getWork', async () => {
    const repositories = new AppRepositories(database.connection)
    const work: Work = {
      id: 'douyin:legacy', creatorId: '', platformWorkId: 'legacy', title: '旧作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/legacy',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:legacy', mediaPath: null,
      downloadUrl: null,
      metrics: { likes: 100, comments: 0, shares: 0, collects: 0 }
    }
    repositories.works.upsert({ id: 'douyin:legacy', creatorId: null, platformWorkId: 'legacy', title: '旧作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/legacy',
      sourceType: 'douyin_monitor' as const, sourceKey: 'douyin:legacy', mediaPath: null,
      downloadUrl: null,
      metrics: { likes: 100, comments: 0, shares: 0, collects: 0 } })
    repositories.analyses.save({
      workId: 'douyin:legacy', transcript: '文字稿',
      result: {
        topicAngle: '角度',
        openingHook: { quote: '钩子', type: 't', mechanism: 'm' },
        structure: ['结构一'],
        viralPoints: ['爆点一'],
        highlights: ['亮点一']
      },
      provider: 'local-agent', model: 'deepseek-v4-flash', promptVersion: 'v1',
      tokenUsage: null, createdAt: new Date().toISOString()
    })

    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    const detail = await runtime.getWork('douyin:legacy')

    expect(detail?.analysis).not.toBeNull()
    expect(detail?.analysis?.topicAngle).toBe('角度')
    expect(detail?.analysis?.contentKeywords).toEqual([])
    expect(detail?.analysis?.reusablePatterns).toEqual([])
    expect(detail?.analysis?.differentiatedSuggestions).toEqual({ angles: [], titles: [], openings: [], risks: [] })
  })

  it('reports logged out when Scrapling rejects the session even if a session cookie exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cookie-test-'))
    try {
      const cookiesDir = join(dir, 'Default', 'Network')
      mkdirSync(cookiesDir, { recursive: true })
      const cookies = new Database(join(cookiesDir, 'Cookies'))
      cookies.exec('CREATE TABLE cookies (host_key TEXT, name TEXT)')
      cookies.prepare("INSERT INTO cookies VALUES ('www.douyin.com', 'sessionid')").run()
      cookies.close()

      const runtime = new DesktopRuntime(database, {
        discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
        profileDirectory: dir,
        isLoggedIn: vi.fn().mockResolvedValue(false),
        closeBrowser: vi.fn().mockResolvedValue(undefined)
      })
      const result = await runtime.checkDouyinLogin()
      expect(result.loggedIn).toBe(false)
      expect((await runtime.getSettings()).douyinLoggedIn).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports an unknown login state when the authoritative probe fails', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      isLoggedIn: vi.fn().mockRejectedValue(new Error('probe failed')),
      closeBrowser: vi.fn().mockResolvedValue(undefined)
    })
    await runtime.saveSettings({ douyinLoggedIn: true })

    await expect(runtime.checkDouyinLogin()).rejects.toMatchObject({
      code: 'DOUYIN_LOGIN_CHECK_FAILED'
    })
    expect((await runtime.getSettings()).douyinLoggedIn).toBe(false)
  })

  it('reports logged in when the scrapling probe succeeds', async () => {
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(), processWork: vi.fn(), login: vi.fn(),
      profileDirectory: join(tmpdir(), 'radar-cookie-absent'),
      isLoggedIn: vi.fn().mockResolvedValue(true)
    })
    await expect(runtime.checkDouyinLogin()).resolves.toEqual({ loggedIn: true })
    expect((await runtime.getSettings()).douyinLoggedIn).toBe(true)
  })

  it('retries exactly the selected discovery-failed creators and records trace metadata', async () => {
    const repositories = new AppRepositories(database.connection)
    for (const id of ['creator-a', 'creator-b']) repositories.creators.create({
      id, platform: 'douyin', name: id, enabled: true,
      profileUrl: `https://www.douyin.com/user/${id}`, createdAt: new Date().toISOString()
    })
    repositories.runs.save({
      id: 'source-run', kind: 'daily', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      summary: { failures: ['creator-a', 'creator-b'].map((creatorId) => ({
        creatorId, creatorName: creatorId, stage: 'discovery', code: 'DOUYIN_CREATOR_COLLECTION_FAILED',
        message: '博主作品采集失败，请稍后重试。', occurredAt: '2026-08-13T00:00:30.000Z'
      })) }
    })
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.retryFailedCreators({ runId: 'source-run', creatorIds: ['creator-b'] })).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))

    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith('creator-b', 'https://www.douyin.com/user/creator-b')
    expect(discover).not.toHaveBeenCalledWith('creator-a', expect.anything())
    const retry = repositories.runs.list().find((run) => run.id !== 'source-run')
    expect(retry?.summary).toMatchObject({ retryOfRunId: 'source-run', targetCreatorIds: ['creator-b'] })
    expect(repositories.runs.get('source-run')?.summary).toMatchObject({ failures: expect.arrayContaining([expect.objectContaining({ creatorId: 'creator-a' })]) })
  })

  it.each([
    ['creator outside the source failure set', ['creator-b']],
    ['a mixed valid and invalid selection', ['creator-a', 'creator-b']]
  ])('rejects %s without any discovery', async (_case, creatorIds) => {
    const repositories = new AppRepositories(database.connection)
    for (const id of ['creator-a', 'creator-b']) repositories.creators.create({
      id, platform: 'douyin', name: id, enabled: true,
      profileUrl: `https://www.douyin.com/user/${id}`, createdAt: new Date().toISOString()
    })
    repositories.runs.save({
      id: 'source-run', kind: 'daily', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      summary: { failures: [{ creatorId: 'creator-a', creatorName: 'A', stage: 'discovery', code: 'X', message: 'safe', occurredAt: '2026-08-13T00:00:30.000Z' }] }
    })
    const discover = vi.fn()
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })

    await expect(runtime.retryFailedCreators({ runId: 'source-run', creatorIds })).resolves.toMatchObject({ accepted: false })
    expect(discover).not.toHaveBeenCalled()
    expect(repositories.runs.list()).toHaveLength(1)
  })

  it('reserves the run slot before asynchronous preparation so concurrent targeted retries cannot both start', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-a', platform: 'douyin', name: 'A', enabled: true,
      profileUrl: 'https://www.douyin.com/user/creator-a', createdAt: new Date().toISOString()
    })
    repositories.runs.save({
      id: 'source-run', kind: 'daily', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      summary: { failures: [{ creatorId: 'creator-a', creatorName: 'A', stage: 'discovery', code: 'X', message: 'safe', occurredAt: '2026-08-13T00:00:30.000Z' }] }
    })
    let resolveSettings!: (value: Awaited<ReturnType<DesktopRuntime['getSettings']>>) => void
    const settings = new Promise<Awaited<ReturnType<DesktopRuntime['getSettings']>>>((resolve) => { resolveSettings = resolve })
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })
    const originalGetSettings = runtime.getSettings.bind(runtime)
    vi.spyOn(runtime, 'getSettings').mockReturnValueOnce(settings)

    const first = runtime.retryFailedCreators({ runId: 'source-run', creatorIds: ['creator-a'] })
    const second = runtime.retryFailedCreators({ runId: 'source-run', creatorIds: ['creator-a'] })
    await expect(second).resolves.toEqual({ accepted: false, reason: '已有任务正在运行' })
    resolveSettings(await originalGetSettings())
    await expect(first).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('rejects a targeted retry when its source failure changes during settings preparation', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-toctou-settings', platform: 'douyin', name: 'A', enabled: true, profileUrl: 'https://www.douyin.com/user/toctou-settings', createdAt: new Date().toISOString() })
    const source = {
      id: 'source-toctou-settings', kind: 'daily' as const, status: 'partial' as const,
      startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      summary: { failures: [{ creatorId: 'creator-toctou-settings', creatorName: 'A', stage: 'discovery', code: 'X', message: 'safe', occurredAt: '2026-08-13T00:00:30.000Z' }] }
    }
    repositories.runs.save(source)
    let resolveSettings!: (value: Awaited<ReturnType<DesktopRuntime['getSettings']>>) => void
    const settings = new Promise<Awaited<ReturnType<DesktopRuntime['getSettings']>>>((resolve) => { resolveSettings = resolve })
    const discover = vi.fn()
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })
    const originalGetSettings = runtime.getSettings.bind(runtime)
    vi.spyOn(runtime, 'getSettings').mockReturnValueOnce(settings)

    const retry = runtime.retryFailedCreators({ runId: source.id, creatorIds: ['creator-toctou-settings'] })
    repositories.runs.save({ ...source, summary: { failures: [] } })
    const mutatedSummary = structuredClone(repositories.runs.get(source.id)?.summary)
    resolveSettings(await originalGetSettings())

    await expect(retry).resolves.toMatchObject({ accepted: false })
    expect(discover).not.toHaveBeenCalled()
    expect(repositories.runs.list()).toHaveLength(1)
    expect(repositories.runs.get(source.id)?.summary).toEqual(mutatedSummary)
  })

  it('rejects a targeted retry when its creator changes during the login probe', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({ id: 'creator-toctou-login', platform: 'douyin', name: 'A', enabled: true, profileUrl: 'https://www.douyin.com/user/toctou-login', createdAt: new Date().toISOString() })
    repositories.runs.save({
      id: 'source-toctou-login', kind: 'daily', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      summary: { failures: [{ creatorId: 'creator-toctou-login', creatorName: 'A', stage: 'discovery', code: 'X', message: 'safe', occurredAt: '2026-08-13T00:00:30.000Z' }] }
    })
    let resolveLogin!: (value: boolean) => void
    const login = new Promise<boolean>((resolve) => { resolveLogin = resolve })
    const discover = vi.fn()
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(), isLoggedIn: vi.fn().mockReturnValue(login), closeBrowser: vi.fn().mockResolvedValue(undefined)
    })

    const retry = runtime.retryFailedCreators({ runId: 'source-toctou-login', creatorIds: ['creator-toctou-login'] })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(false))
    repositories.creators.updateMetadata('creator-toctou-login', 'A', 'https://www.douyin.com/user/toctou-login-changed')
    resolveLogin(true)

    await expect(retry).resolves.toMatchObject({ accepted: false })
    expect(discover).not.toHaveBeenCalled()
    expect(repositories.runs.list()).toHaveLength(1)
  })

  it('parks first capture after login expiry even when persisting the login state fails', async () => {
    const report = vi.fn()
    const discover = vi.fn().mockRejectedValue(Object.assign(new Error('hostile login detail'), {
      code: 'DOUYIN_LOGIN_REQUIRED'
    }))
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn(), report })
    const saveSettings = runtime.saveSettings.bind(runtime)
    vi.spyOn(runtime, 'saveSettings').mockImplementation(async (settings) => {
      if (settings.douyinLoggedIn === false) throw new Error('C:\\private\\settings Bearer secret')
      return saveSettings(settings)
    })

    await runtime.addCreator('https://www.douyin.com/user/login-persistence-failure')
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(discover).toHaveBeenCalledTimes(1)
    expect((await runtime.getDashboard()).run).toMatchObject({
      status: 'partial',
      failures: [expect.objectContaining({ code: 'DOUYIN_LOGIN_REQUIRED', stage: 'discovery' })]
    })
    expect(report).toHaveBeenCalledWith('error', '运行状态保存失败', expect.objectContaining({
      code: 'RUN_STATE_PERSISTENCE_FAILED'
    }))
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|Bearer|secret/)
  })

  it('does not dispatch discovery when shutdown happens during asynchronous preparation', async () => {
    const discover = vi.fn()
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/shutdown-during-preflight')
    let resolveSettings!: (value: Awaited<ReturnType<DesktopRuntime['getSettings']>>) => void
    const pendingSettings = new Promise<Awaited<ReturnType<DesktopRuntime['getSettings']>>>((resolve) => { resolveSettings = resolve })
    const originalGetSettings = runtime.getSettings.bind(runtime)
    vi.spyOn(runtime, 'getSettings').mockReturnValueOnce(pendingSettings)

    const run = runtime.runNow()
    runtime.shutdown()
    resolveSettings(await originalGetSettings())

    await expect(run).resolves.toEqual({ accepted: false, reason: '应用正在退出' })
    expect(discover).not.toHaveBeenCalled()
    expect(runtime.isBusinessIdle()).toBe(true)
  })

  it('releases the reservation when creator preparation throws unexpectedly', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-preparation', platform: 'douyin', name: 'Preparation', enabled: true,
      profileUrl: 'https://www.douyin.com/user/preparation', createdAt: new Date().toISOString()
    })
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn() })
    const internal = (runtime as unknown as { repositories: AppRepositories }).repositories
    vi.spyOn(internal.creators, 'list').mockImplementationOnce(() => { throw new Error('Bearer secret C:\\private') })

    await expect(runtime.runNow()).resolves.toEqual({ accepted: false, reason: '无法准备运行任务，请稍后重试' })
    expect(runtime.isBusinessIdle()).toBe(true)
    expect(discover).not.toHaveBeenCalled()

    await expect(runtime.runNow()).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('parks a first-capture batch when preparation throws and wakes it once after recovery', async () => {
    const discover = vi.fn().mockResolvedValue([])
    const runtime = new DesktopRuntime(database, {
      discover, processWork: vi.fn(), login: vi.fn(),
      isLoggedIn: vi.fn().mockResolvedValue(true), closeBrowser: vi.fn().mockResolvedValue(undefined)
    })
    const internal = (runtime as unknown as { repositories: AppRepositories }).repositories
    const creator = await runtime.addCreator('https://www.douyin.com/user/preparation-recovery')
    vi.spyOn(internal.creators, 'list').mockImplementationOnce(() => { throw new Error('hostile preparation') })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(discover).not.toHaveBeenCalled()

    await runtime.checkDouyinLogin()
    await vi.waitFor(() => expect(discover).toHaveBeenCalledWith(creator.id, creator.profileUrl))
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('turns an execute-run setup failure into a terminal safe run and releases the slot', async () => {
    const repositories = new AppRepositories(database.connection)
    repositories.creators.create({
      id: 'creator-execute-setup', platform: 'douyin', name: 'Execute setup', enabled: true,
      profileUrl: 'https://www.douyin.com/user/execute-setup', createdAt: new Date().toISOString()
    })
    const discover = vi.fn().mockResolvedValue([])
    const report = vi.fn()
    const runtime = new DesktopRuntime(database, { discover, processWork: vi.fn(), login: vi.fn(), report })
    const internal = (runtime as unknown as { repositories: AppRepositories }).repositories
    vi.spyOn(internal.analyses, 'list').mockImplementationOnce(() => { throw new Error('Bearer secret C:\\private') })

    await expect(runtime.runNow()).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect((await runtime.getDashboard()).run).toMatchObject({ status: 'failed', requiresAction: true })
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/Bearer|private|secret/)
    expect(discover).not.toHaveBeenCalled()

    await expect(runtime.runNow()).resolves.toEqual({ accepted: true })
    await vi.waitFor(() => expect(runtime.isBusinessIdle()).toBe(true))
    expect(discover).toHaveBeenCalledTimes(1)
  })
})
