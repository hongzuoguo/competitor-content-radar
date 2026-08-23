import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { Work } from '../../src/core/domain'

const state = vi.hoisted(() => ({
  isPackaged: false,
  manifest: { id: 'sensevoice-small', files: {} },
  scraplingManifest: {
    protocolVersion: 1,
    version: '0.1.0',
    platform: 'win32',
    arch: 'x64',
    archive: { filename: 'scrapling-engine-win32-x64.zip', size: 80_000_000, sha256: 'a'.repeat(64) },
    sourceCommit: 'b'.repeat(40),
    pythonLockSha256: 'c'.repeat(64)
  },
  scraplingBundlePresent: false,
  scraplingArchivePresent: false,
  scraplingManifestRaw: null as string | null,
  resolverOptions: [] as Array<Record<string, unknown>>,
  modelManagerFetches: [] as Array<typeof fetch>,
  modelManagers: [] as Array<object>,
  importServiceOptions: [] as Array<Record<string, unknown>>,
  runtimePorts: [] as Array<Record<string, unknown>>,
  runtimeInstances: [] as Array<{ markFeishuLocalChange: ReturnType<typeof vi.fn>, flushFeishuAfterTask: ReturnType<typeof vi.fn> }>,
  syncCoordinators: [] as Array<{ markLocalChange: ReturnType<typeof vi.fn>, flushAfterTask: ReturnType<typeof vi.fn> }>,
  netFetch: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  probeSenseVoiceModel: vi.fn(),
  resolverResolve: vi.fn(),
  transcribeWithSenseVoice: vi.fn(),
  downloadMedia: vi.fn(),
  extractWav: vi.fn(),
  analyze: vi.fn(),
  detectAgentCli: vi.fn(),
  agentRun: vi.fn(),
  analysisGet: vi.fn(),
  agentRunRewrite: vi.fn(),
  agentTestConnection: vi.fn(),
  activeProfile: null as null | {
    id: string
    name: string
    providerTemplate: 'deepseek' | 'custom'
    baseUrl: string
    modelId: string
    requiresApiKey: boolean
    enabled: boolean
    active: boolean
    createdAt: string
    updatedAt: string
  },
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  secretGet: vi.fn(),
  secretHas: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  ensureScraplingInstalled: vi.fn(),
  checkScraplingHealth: vi.fn(),
  scraplingManagers: [] as Array<{ componentRoot: string, bundledSource: unknown }>,
  sourceLocators: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/user-data'),
    getAppPath: vi.fn(() => 'C:/app'),
    get isPackaged() { return state.isPackaged }
  },
  net: { fetch: state.netFetch },
  shell: { openExternal: vi.fn() }
}))

vi.mock('electron-log/main', () => ({
  default: { info: state.logInfo, warn: state.logWarn, error: vi.fn() }
}))

vi.mock('node:fs', () => {
  const fs = {
    existsSync: vi.fn((path: string) => path.endsWith('manifest.json')
      ? state.scraplingBundlePresent
      : state.scraplingArchivePresent),
    readFileSync: vi.fn((path: string) => path.includes('scrapling-engine')
      ? state.scraplingManifestRaw ?? JSON.stringify(state.scraplingManifest)
      : JSON.stringify(state.manifest))
  }
  return { ...fs, default: fs }
})

vi.mock('node:fs/promises', () => {
  const fs = { mkdir: state.mkdir, rm: state.rm }
  return { ...fs, default: fs }
})

vi.mock('../../src/services/asr/model-manager', () => ({
  ModelManager: class {
    constructor(fetchImplementation: typeof fetch) {
      state.modelManagerFetches.push(fetchImplementation)
      state.modelManagers.push(this)
    }
  }
}))

vi.mock('../../src/services/asr/model-source', () => ({
  ModelSourceResolver: class {
    constructor(options: Record<string, unknown>) {
      state.resolverOptions.push(options)
    }

    resolve = state.resolverResolve
  }
}))

vi.mock('../../src/services/asr/sensevoice', () => ({
  probeSenseVoiceModel: state.probeSenseVoiceModel,
  transcribeWithSenseVoice: state.transcribeWithSenseVoice
}))

vi.mock('../../src/services/database/database', () => ({
  AppDatabase: class {
    connection = {}
    close = vi.fn()
  }
}))

vi.mock('../../src/services/database/repositories', () => ({
  AppRepositories: class {
    settings = { get: state.settingsGet, set: state.settingsSet }
    modelProfiles = {
      get: (id: string) => state.activeProfile?.id === id ? state.activeProfile : null,
      getActive: () => state.activeProfile,
      list: () => state.activeProfile ? [state.activeProfile] : []
    }
    works = { listAll: vi.fn(() => []), finalizeSource: vi.fn() }
    jobs = { list: vi.fn(), saveStage: vi.fn() }
    artifacts = { list: vi.fn(() => []), get: vi.fn(), save: vi.fn() }
    analyses = { get: state.analysisGet }
  }
}))

vi.mock('../../src/services/secrets/secret-store', () => ({
  SecretStore: class { get = state.secretGet; has = state.secretHas; set = vi.fn(); delete = vi.fn() }
}))

vi.mock('../../src/services/media/downloader', () => ({ downloadMedia: state.downloadMedia }))
vi.mock('../../src/services/media/ffmpeg', () => ({ extractWav: state.extractWav }))

vi.mock('../../src/services/ai/analysis-service', () => ({
  AnalysisService: class {
    constructor(private readonly client: { complete: (request: unknown) => Promise<unknown> }) {}
    analyze = async (transcript: string) => {
      await this.client.complete({ messages: [{ role: 'user', content: transcript }] })
      return state.analyze(transcript)
    }
  }
}))

vi.mock('../../src/services/agent/agent-cli-detector', () => ({
  detectAgentCli: state.detectAgentCli
}))

vi.mock('../../src/services/agent/agent-cli-runner', () => ({
  AgentCliRunner: class {
    run = state.agentRun
    runRewrite = state.agentRunRewrite
    testConnection = state.agentTestConnection
  }
}))

vi.mock('../../src/services/media/cleanup', () => ({
  cleanupExpiredMedia: vi.fn(),
  createMediaCleanupOptions: vi.fn(() => ({}))
}))

vi.mock('../../src/services/scrapling-engine/manager', () => ({
  ScraplingEngineManager: class {
    constructor(componentRoot: string, bundledSource: unknown) {
      state.scraplingManagers.push({ componentRoot, bundledSource })
    }
    ensureInstalled = state.ensureScraplingInstalled
  }
}))

vi.mock('../../src/services/scrapling-engine/source-locator', () => ({
  createSourceEngineLocator: (root: string) => {
    state.sourceLocators.push(root)
    return {}
  }
}))

vi.mock('../../src/services/scrapling-engine/runner', () => ({
  ScraplingEngineRunner: class { health = state.checkScraplingHealth }
}))

vi.mock('../../src/services/scrapling-engine/douyin-session', () => ({
  ScraplingDouyinSession: class {}
}))

vi.mock('../../src/services/import/import-service', () => ({
  ImportService: class {
    constructor(options: Record<string, unknown>) {
      state.importServiceOptions.push(options)
    }
    reconcileInterruptedJobs = vi.fn()
    shutdown = vi.fn(async () => undefined)
  }
}))

vi.mock('../../src/main/runtime', () => ({
  DesktopRuntime: class {
    markFeishuLocalChange = vi.fn()
    flushFeishuAfterTask = vi.fn(async () => undefined)

    constructor(_database: unknown, ports: Record<string, unknown>) {
      state.runtimePorts.push(ports)
      state.runtimeInstances.push(this)
    }
    shutdown = vi.fn()
    isBusinessIdle = vi.fn(() => true)
    onBusinessIdle = vi.fn()
  }
}))

vi.mock('../../src/services/feishu/sync-coordinator', () => ({
  FeishuSyncCoordinator: class {
    markLocalChange = vi.fn()
    flushAfterTask = vi.fn(async () => undefined)

    constructor() {
      state.syncCoordinators.push(this)
    }
  }
}))

import { createProductionRuntime, verifyPackagedRuntimeReadiness } from '../../src/main/production-runtime'

describe('production runtime model source', () => {
  let runtime: ReturnType<typeof createProductionRuntime> | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'resourcesPath', { value: 'C:/resources', configurable: true })
    state.isPackaged = false
    state.scraplingBundlePresent = false
    state.scraplingArchivePresent = false
    state.scraplingManifestRaw = null
    state.resolverOptions.length = 0
    state.modelManagerFetches.length = 0
    state.modelManagers.length = 0
    state.importServiceOptions.length = 0
    state.runtimePorts.length = 0
    state.runtimeInstances.length = 0
    state.syncCoordinators.length = 0
    state.scraplingManagers.length = 0
    state.sourceLocators.length = 0
    state.resolverResolve.mockReset().mockResolvedValue('C:/resolved-model')
    state.transcribeWithSenseVoice.mockReset().mockResolvedValue('transcript')
    state.downloadMedia.mockReset().mockResolvedValue(undefined)
    state.extractWav.mockReset().mockResolvedValue('C:/media/work-1/audio.wav')
    state.analyze.mockReset().mockResolvedValue({
      analysis: {}, usage: { inputTokens: 1, outputTokens: 2 }
    })
    state.detectAgentCli.mockReset().mockResolvedValue(null)
    state.agentRun.mockReset()
    state.analysisGet.mockReset().mockReturnValue({ workId: 'written-analysis' })
    state.agentRunRewrite.mockReset()
    state.agentTestConnection.mockReset().mockResolvedValue({ executed: true, ok: true })
    state.netFetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'pong' } }], usage: { prompt_tokens: 1, completion_tokens: 1 }
    }), { status: 200 }))
    state.logInfo.mockReset()
    state.activeProfile = {
      id: 'default-profile', name: 'Default', providerTemplate: 'deepseek', baseUrl: 'https://api.example.test/v1',
      modelId: 'default-model', requiresApiKey: true, enabled: true, active: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
    }
    state.settingsGet.mockReset().mockReturnValue(null)
    state.settingsSet.mockReset()
    state.secretGet.mockReset().mockReturnValue('test-api-key')
    state.secretHas.mockReset().mockReturnValue(false)
    state.mkdir.mockReset().mockResolvedValue(undefined)
    state.rm.mockReset().mockResolvedValue(undefined)
    state.ensureScraplingInstalled.mockReset().mockResolvedValue({ file: 'C:/user-data/components/scrapling/scrapling-engine.exe', args: [], cwd: 'C:/user-data/components/scrapling' })
    state.checkScraplingHealth.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await runtime?.close()
    runtime = undefined
    vi.unstubAllEnvs()
  })

  it('always wires the direct Feishu integration without an OAuth Broker URL', () => {
    runtime = createProductionRuntime()

    expect(state.runtimePorts[0]?.feishu).toBeDefined()
  })

  it('routes import callbacks through the desktop runtime Feishu boundary', async () => {
    runtime = createProductionRuntime()
    const options = state.importServiceOptions[0]
    const desktopRuntime = state.runtimeInstances[0]

    await (options.onLocalDataChanged as () => void)()
    await (options.afterSettled as () => Promise<void>)()

    expect(desktopRuntime.markFeishuLocalChange).toHaveBeenCalledOnce()
    expect(desktopRuntime.flushFeishuAfterTask).toHaveBeenCalledOnce()
    expect(state.syncCoordinators).toHaveLength(0)
    expect((options as Record<string, unknown>).afterAnalyzed).toBeUndefined()
  })

  it('uses the bundled model directory when packaged', async () => {
    state.isPackaged = true
    state.scraplingBundlePresent = true
    state.scraplingArchivePresent = true

    runtime = createProductionRuntime()

    expect(state.resolverOptions).toHaveLength(1)
    const options = state.resolverOptions[0]
    expect(options).toMatchObject({
      manifest: state.manifest,
      bundledDirectory: join('C:/resources', 'models', 'sensevoice-small'),
      cacheDirectory: join('C:/user-data', 'models', 'sensevoice-small')
    })
    expect(state.modelManagerFetches).toHaveLength(1)
    expect(options.manager).toBe(state.modelManagers[0])
    expect(options.probe).toBe(state.probeSenseVoiceModel)
    await state.modelManagerFetches[0]('https://example.test/model')
    expect(state.netFetch).toHaveBeenCalledWith('https://example.test/model', undefined)
    const detail = { candidate: 'bundled' }
    ;(options.log as (message: string, detail?: unknown) => void)('SenseVoice model candidate rejected', detail)
    expect(state.logWarn).toHaveBeenCalledWith('SenseVoice model candidate rejected', { detail })
  })

  it('does not configure a bundled model directory during development', () => {
    runtime = createProductionRuntime()

    expect(state.resolverOptions).toHaveLength(1)
    expect(state.resolverOptions[0]).toMatchObject({
      bundledDirectory: undefined,
      cacheDirectory: join('C:/user-data', 'models', 'sensevoice-small')
    })
  })

  it('resolves a model directory before the import processor transcribes', async () => {
    runtime = createProductionRuntime()
    const processor = state.importServiceOptions[0].processor as {
      transcribe(workId: string, wavPath: string): Promise<string>
    }

    await expect(processor.transcribe('work-1', 'C:/media/work-1/audio.wav')).resolves.toBe('transcript')

    expect(state.resolverResolve).toHaveBeenCalledOnce()
    expect(state.transcribeWithSenseVoice).toHaveBeenCalledWith(
      'C:/media/work-1/audio.wav', 'C:/resolved-model'
    )
  })

  it('resolves a model directory for direct processing with segment progress', async () => {
    runtime = createProductionRuntime()
    const processWork = state.runtimePorts[0].processWork as (
      work: Work,
      settings: unknown,
      onProgress: (progress: unknown) => void
    ) => Promise<unknown>
    const progress = vi.fn()
    const work: Work = {
      id: 'work-1', creatorId: null, platformWorkId: null,
      sourceType: 'douyin_url', sourceKey: 'douyin:work-1', mediaPath: null,
      ownership: 'mine', title: 'Work', publishedAt: '2026-07-29T00:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/work-1', downloadUrl: 'https://example.test/video.mp4',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }

    await processWork(work, { providerId: 'deepseek', modelId: 'deepseek-chat' }, progress)

    expect(state.resolverResolve).toHaveBeenCalledOnce()
    expect(state.transcribeWithSenseVoice).toHaveBeenCalledWith(
      join('C:/user-data', 'media', 'work-1', 'audio.wav'), 'C:/resolved-model', 2, expect.any(Function)
    )
    const onSegment = state.transcribeWithSenseVoice.mock.calls[0][3] as (segment: number, total: number) => void
    onSegment(1, 3)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'audio_extracted' }))
  })

  it('uses the active profile for each new analysis and migrates once at startup', async () => {
    const work: Work = {
      id: 'work-1', creatorId: null, platformWorkId: null,
      sourceType: 'douyin_url', sourceKey: 'douyin:work-1', mediaPath: null,
      ownership: 'mine', title: 'Work', publishedAt: '2026-07-29T00:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/work-1', downloadUrl: 'https://example.test/video.mp4',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    state.activeProfile = {
      id: 'profile-a', name: 'Profile A', providerTemplate: 'deepseek', baseUrl: 'https://api.a.example/v1',
      modelId: 'model-a', requiresApiKey: true, enabled: true, active: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
    }
    state.secretGet.mockReturnValue('key-a')
    runtime = createProductionRuntime()
    const processWork = state.runtimePorts[0].processWork as (
      work: Work,
      settings: unknown,
      onProgress: (progress: unknown) => void
    ) => Promise<unknown>

    const first = await processWork(work, {}, vi.fn())
    state.activeProfile = {
      id: 'profile-b', name: 'Profile B', providerTemplate: 'custom', baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'model-b', requiresApiKey: false, enabled: true, active: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
    }
    const second = await processWork(work, {}, vi.fn())

    expect(state.settingsGet.mock.calls.filter(([key]) => key === 'migration.modelProfiles.v1')).toHaveLength(1)
    expect(first).toMatchObject({ provider: 'deepseek', model: 'model-a' })
    expect(second).toMatchObject({ provider: 'custom', model: 'model-b' })
    expect(state.netFetch.mock.calls).toEqual([
      [
        'https://api.a.example/v1/chat/completions',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key-a' }) })
      ],
      [
        'http://127.0.0.1:11434/v1/chat/completions',
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
      ]
    ])
  })

  it('does not fall back to legacy public settings when no profile is active', async () => {
    state.activeProfile = null
    runtime = createProductionRuntime()
    const processor = state.importServiceOptions[0].processor as {
      analyze(workId: string, transcript: string, settings: unknown): Promise<unknown>
    }

    await expect(processor.analyze('work-1', 'transcript', {
      providerId: 'deepseek', modelId: 'legacy-model'
    }))
      .rejects.toThrow('MODEL_NOT_CONFIGURED')
  })

  it('exposes the active profile identity without decrypting its key', () => {
    state.secretGet.mockImplementation(() => { throw new Error('SECRET_MUST_NOT_BE_READ') })
    runtime = createProductionRuntime()

    const identity = (state.runtimePorts[0].getActiveModelIdentity as () => unknown)()

    expect(identity).toEqual({
      profileId: 'default-profile', providerId: 'deepseek', modelId: 'default-model'
    })
    expect(state.secretGet).not.toHaveBeenCalled()
  })

  it('routes weekly topic clustering through local Codex when selected', async () => {
    const works = [
      { id: 'work-1', title: '工具一', topicAngle: '工具', viralPoints: [] },
      { id: 'work-2', title: '工具二', topicAngle: '工具', viralPoints: [] },
      { id: 'work-3', title: '工具三', topicAngle: '工具', viralPoints: [] }
    ]
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: vi.fn()
    })
    state.agentRunRewrite.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: '```json\n{"categories":[{"name":"AI工具分享","workIds":["work-1","work-2","work-3"]}]}\n```',
      stderr: ''
    })
    runtime = createProductionRuntime()
    const clusterWeeklyTopics = state.runtimePorts[0].clusterWeeklyTopics as (
      items: typeof works,
      settings: Record<string, unknown>
    ) => Promise<unknown>

    await expect(clusterWeeklyTopics(works, {
      runEngine: 'local-agent',
      agentModel: 'gpt-5.6-luna',
      agentReasoningEffort: 'max'
    })).resolves.toEqual({
      categories: [{ name: 'AI工具分享', workIds: ['work-1', 'work-2', 'work-3'] }]
    })
    expect(state.agentRunRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'codex' }),
      expect.stringContaining('短视频内容策略分析师'),
      { model: 'gpt-5.6-luna', reasoningEffort: 'max' }
    )
    expect(state.netFetch).not.toHaveBeenCalled()
  })

  it('routes nodejieba candidate validation through local Codex when selected', async () => {
    const works = [{
      id: 'work-1',
      title: '县城老板用AI搭建企业知识库',
      candidates: ['县城老板', '企业知识库搭建']
    }]
    state.settingsGet.mockImplementation((key: string) => key === 'app.publicSettings'
      ? {
          runEngine: 'local-agent',
          agentModel: 'gpt-5.6-luna',
          agentReasoningEffort: 'high'
        }
      : null)
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: vi.fn()
    })
    state.agentRunRewrite.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: '{"terms":[{"name":"企业知识库搭建","workIds":["work-1"]}]}',
      stderr: ''
    })
    runtime = createProductionRuntime()
    const feishu = state.runtimePorts[0].feishu as unknown as {
      dependencies: { clusterContentTerms(works: typeof works): Promise<unknown> }
    }

    await expect(feishu.dependencies.clusterContentTerms(works)).resolves.toEqual({
      terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }]
    })
    expect(state.agentRunRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'codex' }),
      expect.stringContaining('nodejieba'),
      { model: 'gpt-5.6-luna', reasoningEffort: 'high' }
    )
    expect(state.netFetch).not.toHaveBeenCalled()
  })

  it('maps analysis runner failures to short Chinese reasons without exposing stderr', async () => {
    const work: Work = {
      id: 'work-agent-failure', creatorId: null, platformWorkId: null,
      sourceType: 'douyin_url', sourceKey: 'douyin:work-agent-failure', mediaPath: null,
      ownership: 'mine', title: 'Work', publishedAt: '2026-07-29T00:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/work-agent-failure',
      downloadUrl: 'https://example.test/video.mp4',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: vi.fn()
    })
    runtime = createProductionRuntime()
    const runAgentAnalysis = state.runtimePorts[0].runAgentAnalysis as (
      work: Work, settings: Record<string, unknown>
    ) => Promise<void>
    const cases = [
      ['AGENT_ENDPOINT_UNAVAILABLE', 'HitMuse 本地服务尚未启动，请重试'],
      ['AGENT_MCP_UNAVAILABLE', 'Codex 无法连接 HitMuse 工具服务，请重试'],
      ['AGENT_CLI_LOGIN_REQUIRED', 'Codex 尚未登录，请先登录后重试'],
      ['AGENT_MODEL_UNAVAILABLE', '所选 Codex 模型不可用，请更换模型'],
      ['AGENT_CLI_RATE_LIMITED', 'Codex 请求过于频繁，请稍后重试'],
      ['AGENT_CLI_PERMISSION_DENIED', 'Codex 无权完成本次任务，请检查账号权限'],
      ['AGENT_CLI_STDIN_FAILED', '无法向 Codex 发送任务内容，请重试'],
      ['AGENT_CLI_TIMEOUT', 'Codex 执行超时，请稍后重试'],
      ['AGENT_CLI_FAILED', 'Codex 执行失败，请稍后重试']
    ] as const

    for (const [errorCode, message] of cases) {
      state.agentRun.mockResolvedValueOnce({
        ok: false, exitCode: 1, stdout: '', stderr: 'private process detail', errorCode
      })
      await expect(runAgentAnalysis(work, {})).rejects.toMatchObject({ message, code: errorCode })
    }
  })

  it('rejects a zero-exit Codex run that did not write an analysis', async () => {
    const work: Work = {
      id: 'work-agent-no-result', creatorId: null, platformWorkId: null,
      sourceType: 'douyin_url', sourceKey: 'douyin:work-agent-no-result', mediaPath: null,
      ownership: 'mine', title: 'Work', publishedAt: '2026-07-29T00:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/work-agent-no-result',
      downloadUrl: 'https://example.test/video.mp4',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    }
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: vi.fn()
    })
    state.agentRun.mockResolvedValue({ ok: true, exitCode: 0, stdout: 'done', stderr: '' })
    state.analysisGet.mockReturnValue(null)
    runtime = createProductionRuntime()
    const runAgentAnalysis = state.runtimePorts[0].runAgentAnalysis as (
      work: Work, settings: Record<string, unknown>
    ) => Promise<void>

    await expect(runAgentAnalysis(work, {})).rejects.toMatchObject({
      code: 'AGENT_RESULT_MISSING',
      message: 'Codex 未写回有效拆解结果，请重试'
    })
  })

  it('does not put raw Codex stderr in rewrite errors or application logs', async () => {
    const privateDetail = 'Authorization: Bearer private-token'
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'codex', displayName: 'Codex', execArgs: vi.fn()
    })
    state.agentRunRewrite.mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: privateDetail,
      errorCode: 'AGENT_CLI_TIMEOUT'
    })
    runtime = createProductionRuntime()
    const agentRewrite = state.runtimePorts[0].agentRewrite as (
      workId: string,
      payload: Record<string, unknown>,
      settings: Record<string, unknown>
    ) => Promise<unknown>
    const payload = {
      title: '标题', topicAngle: '角度', openingHookQuote: '钩子', openingHookType: '类型',
      openingHookMechanism: '机制', structure: [], viralPoints: [], highlights: [],
      reusablePatterns: [], userContext: '背景', wordCount: 300
    }

    await expect(agentRewrite('work-1', payload, {})).rejects.toMatchObject({
      message: 'Codex 执行超时，请稍后重试',
      code: 'AGENT_CLI_TIMEOUT'
    })
    expect(JSON.stringify(state.logInfo.mock.calls)).not.toContain('private-token')
    expect(JSON.stringify(state.logInfo.mock.calls)).not.toContain(privateDetail)
  })

  it('probes the packaged embedded engine and bundled SenseVoice recognizer without user audio', async () => {
    state.isPackaged = true
    state.scraplingBundlePresent = true
    state.scraplingArchivePresent = true
    state.probeSenseVoiceModel.mockResolvedValue(undefined)

    await expect(verifyPackagedRuntimeReadiness('C:/user-data')).resolves.toBeUndefined()

    expect(state.scraplingManagers).toContainEqual(expect.objectContaining({ componentRoot: 'C:\\user-data\\components' }))
    expect(state.checkScraplingHealth).toHaveBeenCalledWith(expect.objectContaining({ file: expect.stringContaining('scrapling-engine.exe') }))
    expect(state.probeSenseVoiceModel).toHaveBeenCalledWith('C:\\resources\\models\\sensevoice-small')
  })

  it('uses the current checkout Python engine during development', () => {
    runtime = createProductionRuntime()

    expect(state.sourceLocators).toEqual(['C:/app'])
    expect(state.scraplingManagers).toEqual([])
  })

  it.each([
    ['manifest', false, true],
    ['archive', true, false]
  ])('requires an embedded engine %s when packaged', (_missing, manifestPresent, archivePresent) => {
    state.isPackaged = true
    state.scraplingBundlePresent = manifestPresent
    state.scraplingArchivePresent = archivePresent

    expect(() => createProductionRuntime()).toThrow(expect.objectContaining({
      code: 'SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE'
    }))
    expect(state.sourceLocators).toEqual([])
  })

  it('reports malformed packaged engine manifest JSON with a stable error code', () => {
    state.isPackaged = true
    state.scraplingBundlePresent = true
    state.scraplingArchivePresent = true
    state.scraplingManifestRaw = '{'

    expect(() => createProductionRuntime()).toThrow(expect.objectContaining({
      code: 'SCRAPLING_ENGINE_MANIFEST_INVALID', retryable: false
    }))
  })

  it('maps only a missing where result to not found and hides unexpected probe errors', async () => {
    const module = await import('../../src/main/production-runtime') as Record<string, unknown>
    const classify = module.classifyAgentCliWhereFailure
    const rawDetail = 'spawn where ENOENT C:/private/codex-cli-sentinel.exe'

    expect(classify).toEqual(expect.any(Function))
    expect((classify as (error: unknown) => false)(Object.assign(new Error(rawDetail), { status: 1 }))).toBe(false)
    for (const failure of [
      Object.assign(new Error(rawDetail), { code: 'ENOENT' }),
      Object.assign(new Error(rawDetail), { status: 2 })
    ]) {
      expect(() => (classify as (error: unknown) => false)(failure)).toThrow('AGENT_CLI_PROBE_FAILED')
      try {
        ;(classify as (error: unknown) => false)(failure)
      } catch (error) {
        expect((error as Error).message).not.toContain(rawDetail)
      }
    }
  })

  it('logs only safe Codex rewrite completion metadata and never writes probe diagnostics to stderr', async () => {
    const cliPath = 'C:/private/codex-cli-sentinel.exe'
    const apiKey = 'api-key-sentinel'
    const appSecret = 'app-secret-sentinel'
    const cookie = 'cookie-sentinel'
    const rawStdout = `stdout api_key=${apiKey}`
    const rawStderr = `app_secret=${appSecret}\nCookie: session=${cookie}`
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: cliPath, displayName: 'Codex', execArgs: vi.fn()
    })
    state.agentRunRewrite.mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: rawStdout,
      stderr: rawStderr,
      errorCode: 'AGENT_CLI_FAILED'
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    runtime = createProductionRuntime()
    const agentRewrite = state.runtimePorts[0].agentRewrite as (
      workId: string,
      payload: Record<string, unknown>,
      settings: Record<string, unknown>
    ) => Promise<unknown>
    const payload = {
      title: '标题', topicAngle: '角度', openingHookQuote: '钩子', openingHookType: '类型',
      openingHookMechanism: '机制', structure: [], viralPoints: [], highlights: [],
      reusablePatterns: [], userContext: '背景', wordCount: 300
    }

    await expect(agentRewrite('work-1', payload, { agentCliPath: cliPath })).rejects.toMatchObject({
      message: 'Codex 执行失败，请稍后重试',
      code: 'AGENT_CLI_FAILED'
    })

    const finished = state.logInfo.mock.calls.find(([message]) => message === 'rewriteWork via agent: cli finished')
    expect(finished).toEqual([
      'rewriteWork via agent: cli finished',
      {
        ok: false,
        exitCode: 1,
        errorCode: 'AGENT_CLI_FAILED',
        stderrBytes: Buffer.byteLength(rawStderr, 'utf8'),
        stdoutBytes: Buffer.byteLength(rawStdout, 'utf8')
      }
    ])
    expect(stderr).not.toHaveBeenCalled()
    for (const privateValue of [cliPath, apiKey, appSecret, cookie, rawStdout, rawStderr]) {
      expect(JSON.stringify(state.logInfo.mock.calls)).not.toContain(privateValue)
    }
    stderr.mockRestore()
  })

  it('times out a hanging connection test and maps it to CONNECTION_TIMEOUT', async () => {
    vi.useFakeTimers()
    let aborted = false
    state.netFetch.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('Request aborted', 'AbortError'))
      })
    }))
    runtime = createProductionRuntime({ connectionTestTimeoutMs: 10 })

    const result = runtime.modelProfiles.testConnection({
      name: 'Local model', providerTemplate: 'custom', baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'local-model', requiresApiKey: false, enabled: true
    })
    await vi.advanceTimersByTimeAsync(10)

    await expect(result).resolves.toMatchObject({ executed: true, ok: false, errorCode: 'CONNECTION_TIMEOUT' })
    expect(aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the connection-test timer when the model responds promptly', async () => {
    vi.useFakeTimers()
    runtime = createProductionRuntime({ connectionTestTimeoutMs: 10 })

    await expect(runtime.modelProfiles.testConnection({
      name: 'Local model', providerTemplate: 'custom', baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'local-model', requiresApiKey: false, enabled: true
    })).resolves.toEqual({ executed: true, ok: true })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('disables thinking and allows a short answer for a DeepSeek connection probe', async () => {
    runtime = createProductionRuntime()

    await expect(runtime.modelProfiles.testActiveConnection()).resolves.toEqual({ executed: true, ok: true })

    const request = state.netFetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16,
      thinking: { type: 'disabled' }
    })
  })

  it('does not send DeepSeek thinking options to a custom provider probe', async () => {
    state.activeProfile = { ...state.activeProfile!, providerTemplate: 'custom' }
    runtime = createProductionRuntime()

    await expect(runtime.modelProfiles.testActiveConnection()).resolves.toEqual({ executed: true, ok: true })

    const request = state.netFetch.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.max_tokens).toBe(16)
    expect(body.thinking).toBeUndefined()
  })

  it('gets the current Codex executable identity without sending a model probe', async () => {
    state.settingsGet.mockImplementation((key: string) => key === 'app.publicSettings'
      ? { agentModel: ' gpt-5.6-terra ', agentReasoningEffort: 'high' }
      : null)
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'C:/tools/codex.exe', displayName: 'Codex', execArgs: vi.fn()
    })
    runtime = createProductionRuntime()

    const health = await runtime.engineHealth.get()

    expect(health.codex.fingerprint).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(JSON.stringify(health)).not.toContain('C:/tools/codex.exe')
    expect(JSON.stringify(health)).not.toContain('gpt-5.6-terra')
    expect(state.detectAgentCli).toHaveBeenCalledOnce()
    expect(state.agentTestConnection).not.toHaveBeenCalled()
  })

  it('uses a silent detector for passive Codex health reads', async () => {
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'C:/private/codex.exe', displayName: 'Codex', execArgs: vi.fn()
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    runtime = createProductionRuntime()

    await runtime.engineHealth.get()

    expect(stderr).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it('preserves stable Codex probe failures instead of reporting the CLI as missing', async () => {
    const rawDetail = 'C:/private/codex-cli-sentinel.exe ENOENT'
    const failure = Object.assign(new Error('AGENT_CLI_PROBE_FAILED'), { rawDetail })
    state.detectAgentCli.mockRejectedValue(failure)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    runtime = createProductionRuntime()

    await expect(runtime.engineHealth.get()).rejects.toThrow('AGENT_CLI_PROBE_FAILED')
    await expect(runtime.engineHealth.refreshAll()).rejects.toThrow('AGENT_CLI_PROBE_FAILED')
    expect(stderr).not.toHaveBeenCalled()
    expect(JSON.stringify(state.logInfo.mock.calls)).not.toContain(rawDetail)
    stderr.mockRestore()
  })

  it('refreshes the production-owned health service through exactly one cloud and one Codex probe', async () => {
    state.settingsGet.mockImplementation((key: string) => key === 'app.publicSettings'
      ? { agentModel: 'gpt-5.6-terra', agentReasoningEffort: 'high' }
      : null)
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'C:/tools/codex.exe', displayName: 'Codex', execArgs: vi.fn()
    })
    runtime = createProductionRuntime()

    await expect(runtime.engineHealth.refreshAll()).resolves.toMatchObject({
      cloud: { status: 'healthy' },
      codex: { status: 'healthy' },
      checking: false
    })
    expect(state.netFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(String((state.netFetch.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16,
      thinking: { type: 'disabled' }
    })
    expect(state.agentTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'C:/tools/codex.exe' }),
      { model: 'gpt-5.6-terra', reasoningEffort: 'high' }
    )
  })

  it('persists opaque health fingerprints without profile URL tokens or CLI paths', async () => {
    state.activeProfile = {
      ...state.activeProfile!,
      baseUrl: 'https://user:base-url-token@example.test/v1?access_token=base-url-token'
    }
    state.settingsGet.mockImplementation((key: string) => key === 'app.publicSettings'
      ? { agentCliPath: 'C:/private/path/cli-token/codex.exe' }
      : null)
    state.detectAgentCli.mockResolvedValue({
      id: 'codex', command: 'C:/private/path/cli-token/codex.exe', displayName: 'Codex', execArgs: vi.fn()
    })
    runtime = createProductionRuntime()

    const health = await runtime.engineHealth.refreshAll()
    const persisted = JSON.stringify(state.settingsSet.mock.calls.filter(([key]) => key === 'engine.health.v1'))
    const exposed = JSON.stringify(health)

    expect(health.cloud.fingerprint).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(health.codex.fingerprint).toMatch(/^v1:[a-f0-9]{64}$/)
    for (const value of [persisted, exposed]) {
      expect(value).not.toContain('base-url-token')
      expect(value).not.toContain('C:/private/path')
    }
  })

  it('keeps committed mutations successful when health invalidation fails and logs only a stable code', async () => {
    runtime = createProductionRuntime()
    vi.spyOn(runtime.engineHealth, 'invalidateCloud').mockRejectedValue(new Error('Bearer private-secret'))
    const registry = (runtime.agentLifecycle as unknown as {
      options: { registry: { invoke(name: string, input: unknown, context: { source: 'local-api' }): Promise<unknown> } }
    }).options.registry

    await expect(registry.invoke('modelProfiles.setApiKey', {
      id: 'default-profile', apiKey: 'top-secret'
    }, { source: 'local-api' })).resolves.toEqual({ ok: true })

    await vi.waitFor(() => expect(state.logWarn).toHaveBeenCalledWith(
      'Engine health invalidation failed',
      { errorCode: 'ENGINE_HEALTH_INVALIDATION_FAILED', engine: 'cloud' }
    ))
    expect(JSON.stringify(state.logWarn.mock.calls)).not.toContain('private-secret')
  })

  it('maps a generic cloud probe failure to the canonical cloud health code', async () => {
    state.netFetch.mockRejectedValue(new Error('network private detail'))
    runtime = createProductionRuntime()

    await expect(runtime.engineHealth.refreshAll()).resolves.toMatchObject({
      cloud: { status: 'unhealthy', code: 'CLOUD_CONNECTION_FAILED' },
      codex: { status: 'unhealthy', code: 'CODEX_CLI_NOT_FOUND' }
    })
  })
})
