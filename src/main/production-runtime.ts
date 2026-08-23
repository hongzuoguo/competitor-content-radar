import { app, net, shell } from 'electron'
import { createHash } from 'node:crypto'
import log from 'electron-log/main'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AppDatabase } from '../services/database/database'
import { AppRepositories } from '../services/database/repositories'
import { downloadMedia } from '../services/media/downloader'
import { extractWav } from '../services/media/ffmpeg'
import { cleanupExpiredMedia, createMediaCleanupOptions } from '../services/media/cleanup'
import { ModelManager } from '../services/asr/model-manager'
import { ModelSourceResolver, type ModelManifest } from '../services/asr/model-source'
import { probeSenseVoiceModel, transcribeWithSenseVoice } from '../services/asr/sensevoice'
import { SecretStore } from '../services/secrets/secret-store'
import { AI_PROVIDER_CATALOG } from '../services/ai/provider-catalog'
import { OpenAiCompatibleClient } from '../services/ai/openai-compatible'
import { ModelProfileService, type RuntimeModelProfile } from '../services/ai/model-profile-service'
import { EngineHealthService } from '../services/ai/engine-health-service'
import { AnalysisService } from '../services/ai/analysis-service'
import { RewriteService, buildSystemPrompt, buildUserPrompt, parseRewrite } from '../services/ai/rewrite-service'
import {
  WeeklyTopicClusteringService,
  buildWeeklyTopicClusteringPrompt,
  parseAndValidateCluster
} from '../services/ai/weekly-topic-clustering'
import {
  ContentTermClusteringService,
  buildContentTermClusteringPrompt,
  parseAndValidateContentTerms,
  type ContentTermCandidateWork
} from '../services/ai/content-term-clustering'
import { ANALYSIS_PROMPT_VERSION } from '../services/ai/prompt'
import { DesktopRuntime, type ProcessedWork, type RuntimePorts, type WorkProcessProgress } from './runtime'
import type { Work } from '../core/domain'
import type { PublicSettings, RewriteRequestView, RewriteResultView } from '../shared/ipc-contract'
import { ImportService, type ImportNotificationPort, type WorkProcessor } from '../services/import/import-service'
import { ingestLocalFile } from '../services/import/local-file-source'
import { resolveDouyinVideo } from '../services/import/douyin-video-source'
import { resolveDouyinCreatorUrl } from '../services/douyin/creator-url'
import { refreshDouyinWorkSource } from '../services/douyin/refresh-work-source'
import { createCreatorRedirectFetch } from './creator-redirect-request'
import { ScraplingEngineManager, type ScraplingBundledSource } from '../services/scrapling-engine/manager'
import { ScraplingEngineRunner } from '../services/scrapling-engine/runner'
import { ScraplingDouyinSession } from '../services/scrapling-engine/douyin-session'
import { parseScraplingEngineManifest } from '../services/scrapling-engine/manifest'
import { createSourceEngineLocator } from '../services/scrapling-engine/source-locator'
import { closeDedicatedBrowser, clearDouyinProfile, launchDedicatedBrowser } from '../services/douyin/dedicated-browser'
import { FeishuHttpClient } from '../services/feishu/client'
import { FeishuTenantTokenProvider } from '../services/feishu/custom-app-auth'
import { FeishuIntegration } from '../services/feishu/integration'
import { AgentAccessService } from '../services/agent/agent-access-service'
import { AgentAuditService } from '../services/agent/agent-audit-service'
import { AgentLifecycle } from '../services/agent/agent-lifecycle'
import { AgentManager } from '../services/agent/agent-manager'
import { CapabilityRegistry } from '../services/agent/capability-registry'
import { detectAgentCli, type DetectedAgentCli } from '../services/agent/agent-cli-detector'
import { AgentCliRunner } from '../services/agent/agent-cli-runner'
import { createApplicationCapabilityRegistry, type AgentApplicationFacade } from '../services/agent/application-capabilities'
import { RuntimeAgentFacade } from '../services/agent/runtime-agent-facade'
import { version as APP_VERSION } from '../../package.json'

export interface ProductionRuntime {
  runtime: DesktopRuntime
  modelProfiles: ModelProfileService
  /** The one process-wide owner of persisted cloud/Codex probe state. */
  engineHealth: EngineHealthService
  agentManager: AgentManager
  agentLifecycle: AgentLifecycle
  /** Probes for an installed Agent CLI, honoring settings.agentCliPath. */
  detectAgentCli(settings: PublicSettings): Promise<DetectedAgentCli | null>
  /** Rewrites a competitor's article in the user's voice using Humanizer-zh rules. */
  rewriteWork(workId: string, payload: RewriteRequestView): Promise<RewriteResultView>
  close(): Promise<void>
}

export interface ProductionRuntimeOptions {
  notification?: ImportNotificationPort
  connectionTestTimeoutMs?: number
}

export async function verifyPackagedRuntimeReadiness(userData: string): Promise<void> {
  if (!app.isPackaged) throw new Error('HITMUSE_SMOKE_RUNTIME_READINESS_REQUIRES_PACKAGED_APP')
  const scraplingEngine = new ScraplingEngineManager(join(userData, 'components'), loadBundledScraplingSource())
  const command = await scraplingEngine.ensureInstalled()
  await new ScraplingEngineRunner().health(command)
  const modelManifest = JSON.parse(
    readFileSync(join(app.getAppPath(), 'resources', 'model-manifest.json'), 'utf8')
  ) as ModelManifest
  await probeSenseVoiceModel(join(process.resourcesPath, 'models', modelManifest.id))
}

function agentFailureMessage(code?: string): string {
  const messages: Record<string, string> = {
    AGENT_ENDPOINT_UNAVAILABLE: 'HitMuse 本地服务尚未启动，请重试',
    AGENT_MCP_UNAVAILABLE: 'Codex 无法连接 HitMuse 工具服务，请重试',
    AGENT_CLI_NOT_FOUND: '未检测到 Codex CLI，请先安装并登录 Codex',
    AGENT_CLI_LOGIN_REQUIRED: 'Codex 尚未登录，请先登录后重试',
    AGENT_MODEL_UNAVAILABLE: '所选 Codex 模型不可用，请更换模型',
    AGENT_CLI_RATE_LIMITED: 'Codex 请求过于频繁，请稍后重试',
    AGENT_CLI_PERMISSION_DENIED: 'Codex 无权完成本次任务，请检查账号权限',
    AGENT_CLI_STDIN_FAILED: '无法向 Codex 发送任务内容，请重试',
    AGENT_CLI_TIMEOUT: 'Codex 执行超时，请稍后重试',
    AGENT_RESULT_MISSING: 'Codex 未写回有效拆解结果，请重试',
    AGENT_CLI_FAILED: 'Codex 执行失败，请稍后重试'
  }
  return messages[code ?? ''] ?? 'Codex 执行失败，请稍后重试'
}

export function createProductionRuntime(options: ProductionRuntimeOptions = {}): ProductionRuntime {
  // Windows desktop-launched Electron processes often inherit an incomplete
  // PATH (or none at all). Restore the full user/system PATH from the
  // registry so `where` and spawned Agent CLIs can resolve correctly.
  ensureWindowsPath(process.env)
  const userData = app.getPath('userData')
  const mediaDirectory = join(userData, 'media')
  const database = new AppDatabase(join(userData, 'content-radar.db'))
  const repositories = new AppRepositories(database.connection)
  const secrets = new SecretStore(repositories.settings)
  const electronFetch: typeof fetch = (input, init) => net.fetch(input.toString(), init)
  let engineHealthRef: EngineHealthService | null = null
  const modelProfiles = new ModelProfileService({
    profiles: repositories.modelProfiles,
    settings: repositories.settings,
    secrets,
    connectionTester: async (profile) => {
      await createClientForProfile(
        profile,
        profile.providerTemplate === 'deepseek',
        options.connectionTestTimeoutMs ?? 15_000
      ).complete({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 16
      })
      return { executed: true, ok: true }
    },
    connectionLogger: (entry) => log.info('Model profile connection test', entry),
    onChanged: () => invalidateEngineHealth('cloud')
  })
  modelProfiles.migrateLegacyProfile()
  let agentLifecycleRef: AgentLifecycle | null = null
  let agentCliRunnerRef: AgentCliRunner | null = null
  const feishu = new FeishuIntegration({
    repositories,
    credentials: secrets,
    tokenProviderFactory: (credentials) => new FeishuTenantTokenProvider(credentials, {
      fetchImplementation: electronFetch,
      log: (message, detail) => log.info(`feishu auth: ${message}`, detail ?? '')
    }),
    clientFactory: (accessToken) => new FeishuHttpClient(
      accessToken,
      electronFetch,
      (message, detail) => log.info(`feishu api: ${message}`, detail ?? '')
    ),
    openExternal: (url) => shell.openExternal(url).then(() => undefined),
    clusterTopics: (works, preferredCategoryNames) => (
      clusterTopicsWithSelectedEngine(works, preferredCategoryNames)
    ),
    clusterContentTerms: (works) => clusterContentTermsWithSelectedEngine(works),
    log: (message, detail) => log.info(`feishu: ${message}`, detail ?? '')
  })
  const scraplingEngine = app.isPackaged
    ? new ScraplingEngineManager(join(userData, 'components'), loadBundledScraplingSource())
    : createSourceEngineLocator(app.getAppPath())
  const douyin = new ScraplingDouyinSession(
    scraplingEngine,
    new ScraplingEngineRunner(),
    join(userData, 'scrapling-browser-profile'),
    (message, detail) => log.info(message, detail ?? ''),
    launchDedicatedBrowser,
    closeDedicatedBrowser,
    clearDouyinProfile
  )
  const savedSettings = repositories.settings.get<PublicSettings>('app.publicSettings')
  if (savedSettings && savedSettings.douyinProfileVersion !== 2) {
    repositories.settings.set('app.publicSettings', {
      ...savedSettings,
      douyinLoggedIn: false,
      douyinProfileVersion: 2
    })
  }
  const modelManifest = JSON.parse(
    readFileSync(join(app.getAppPath(), 'resources', 'model-manifest.json'), 'utf8')
  ) as ModelManifest
  const modelSource = new ModelSourceResolver({
    manifest: modelManifest,
    bundledDirectory: app.isPackaged ? join(process.resourcesPath, 'models', modelManifest.id) : undefined,
    cacheDirectory: join(userData, 'models', modelManifest.id),
    manager: new ModelManager(electronFetch),
    probe: probeSenseVoiceModel,
    log: (message, detail) => log.warn(message, { detail })
  })

  function createClientForProfile(
    profile: RuntimeModelProfile,
    structuredOutput = false,
    requestTimeoutMs?: number
  ): OpenAiCompatibleClient {
    return new OpenAiCompatibleClient({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.modelId,
      fetchImplementation: electronFetch,
      requestTimeoutMs,
      ...(structuredOutput && profile.providerTemplate === 'deepseek' ? { thinking: 'disabled' as const } : {})
    })
  }

  function createAiClient(structuredOutput = false, requestTimeoutMs?: number): { client: OpenAiCompatibleClient, profile: RuntimeModelProfile } {
    const profile = modelProfiles.getActiveRuntimeProfile()
    if (!profile) throw new Error('MODEL_NOT_CONFIGURED')
    if (profile.requiresApiKey && !profile.apiKey) throw new Error('AI_SETTINGS_MISSING')
    return { client: createClientForProfile(profile, structuredOutput, requestTimeoutMs), profile }
  }

  async function clusterTopicsWithSelectedEngine(
    works: Parameters<WeeklyTopicClusteringService['cluster']>[0],
    preferredCategoryNames: string[] = [],
    selectedSettings?: PublicSettings
  ) {
    const settings = selectedSettings ?? repositories.settings.get<PublicSettings>('app.publicSettings')
    if (settings?.runEngine !== 'local-agent') {
      return new WeeklyTopicClusteringService(createAiClient(true).client)
        .cluster(works, preferredCategoryNames)
    }
    if (!agentCliRunnerRef) {
      throw Object.assign(new Error('本地 Codex 引擎未就绪'), { code: 'AGENT_ENGINE_UNAVAILABLE' })
    }
    const agent = await probeAgentCli(settings.agentCliPath ?? '')
    if (!agent) {
      throw Object.assign(new Error('未检测到 Codex CLI，请先安装并登录 Codex，然后到设置中检测是否可用'), {
        code: 'AGENT_CLI_NOT_FOUND'
      })
    }
    const result = await agentCliRunnerRef.runRewrite(
      agent,
      buildWeeklyTopicClusteringPrompt(works, preferredCategoryNames),
      { model: settings.agentModel, reasoningEffort: settings.agentReasoningEffort }
    )
    if (!result.ok) {
      throw Object.assign(new Error(agentFailureMessage(result.errorCode)), {
        code: result.errorCode ?? 'AGENT_TOPIC_CLUSTERING_FAILED'
      })
    }
    return parseAndValidateCluster(result.stdout, works)
  }

  async function clusterContentTermsWithSelectedEngine(
    works: ContentTermCandidateWork[],
    selectedSettings?: PublicSettings
  ) {
    const settings = selectedSettings ?? repositories.settings.get<PublicSettings>('app.publicSettings')
    if (settings?.runEngine !== 'local-agent') {
      return new ContentTermClusteringService(createAiClient(true).client).cluster(works)
    }
    if (!agentCliRunnerRef) {
      throw Object.assign(new Error('本地 Codex 引擎未就绪'), { code: 'AGENT_ENGINE_UNAVAILABLE' })
    }
    const agent = await probeAgentCli(settings.agentCliPath ?? '')
    if (!agent) {
      throw Object.assign(new Error('未检测到 Codex CLI，请先安装并登录 Codex，然后到设置中检测是否可用'), {
        code: 'AGENT_CLI_NOT_FOUND'
      })
    }
    const result = await agentCliRunnerRef.runRewrite(
      agent,
      buildContentTermClusteringPrompt(works),
      { model: settings.agentModel, reasoningEffort: settings.agentReasoningEffort }
    )
    if (!result.ok) {
      throw Object.assign(new Error(agentFailureMessage(result.errorCode)), {
        code: result.errorCode ?? 'AGENT_CONTENT_TERM_CLUSTERING_FAILED'
      })
    }
    return parseAndValidateContentTerms(result.stdout, works)
  }

  const processor: WorkProcessor = {
    async extractAudio(workId, videoPath) {
      const workDirectory = join(mediaDirectory, workId.replaceAll(':', '_'))
      const wavPath = join(workDirectory, 'audio.wav')
      await mkdir(workDirectory, { recursive: true })
      await extractWav(videoPath, wavPath)
      return wavPath
    },
    async transcribe(_workId, wavPath) {
      const modelDirectory = await modelSource.resolve()
      return transcribeWithSenseVoice(wavPath, modelDirectory)
    },
    async analyze(_workId, transcript, _rawSettings) {
      // Content analysis requires a single machine-readable answer. DeepSeek's
      // thinking stream can otherwise leave the final JSON incomplete.
      const { client, profile } = createAiClient(true)
      const output = await new AnalysisService(client).analyze(transcript)
      return {
        result: output.analysis, provider: profile.providerTemplate, model: profile.modelId,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        tokenUsage: { input: output.usage.inputTokens, output: output.usage.outputTokens }
      }
    }
  }

  /**
   * Ensures a work has a transcript, downloading and transcribing it when
   * needed. Shared by the cloud engine (processWork) and the local Agent
   * engine (runAgentAnalysis) so both analyze the same real transcript.
   */
  async function ensureTranscript(work: Work, onProgress?: (progress: WorkProcessProgress) => void): Promise<string> {
    const savedTranscript = repositories.artifacts.get(work.id)?.transcript
    if (savedTranscript) return savedTranscript
    let sourceWork = work
    const workDirectory = join(mediaDirectory, work.id.replaceAll(':', '_'))
    const videoPath = join(workDirectory, 'video.mp4')
    onProgress?.({ stage: 'discovered', label: '正在下载视频' })
    try {
      if (!sourceWork.downloadUrl) throw Object.assign(new Error('作品没有可用的公开下载地址'), {
        code: 'DOUYIN_MEDIA_URL_MISSING', retryable: false
      })
      await downloadMedia(sourceWork.downloadUrl, videoPath, electronFetch)
    } catch (error) {
      const refreshedWork = await refreshDouyinWorkSource(work, douyin)
      if (refreshedWork === work) throw error
      sourceWork = refreshedWork
      repositories.works.finalizeSource(work.id, {
        sourceKey: sourceWork.sourceKey,
        mediaPath: sourceWork.mediaPath,
        title: sourceWork.title,
        originalUrl: sourceWork.originalUrl,
        downloadUrl: sourceWork.downloadUrl
      })
      onProgress?.({ stage: 'discovered', label: '正在重新获取视频地址后下载' })
      await downloadMedia(sourceWork.downloadUrl!, videoPath, electronFetch)
    }
    repositories.jobs.saveStage(work.id, 'downloaded')
    onProgress?.({ stage: 'downloaded', label: '视频已下载，正在提取音频' })
    const wavPath = await processor.extractAudio(work.id, videoPath)
    repositories.jobs.saveStage(work.id, 'audio_extracted')
    onProgress?.({ stage: 'audio_extracted', label: '音频已提取，正在转写文字' })
    const modelDirectory = await modelSource.resolve()
    const transcript = await transcribeWithSenseVoice(wavPath, modelDirectory, 2, (segment, totalSegments) => {
      onProgress?.({ stage: 'audio_extracted', label: `正在转写第 ${segment}/${totalSegments} 段` })
    })
    repositories.jobs.saveStage(work.id, 'transcribed')
    onProgress?.({ stage: 'transcribed', label: '文字稿已完成' })
    const existingArtifact = repositories.artifacts.get(work.id)
    repositories.artifacts.save({
      workId: work.id,
      wavPath,
      transcript,
      existingWorkId: existingArtifact?.existingWorkId ?? null,
      updatedAt: new Date().toISOString()
    })
    return transcript
  }

  async function processWork(
    work: Work,
    settings: PublicSettings,
    onProgress?: (progress: WorkProcessProgress) => void
  ): Promise<ProcessedWork> {
    const transcript = await ensureTranscript(work, onProgress)
    onProgress?.({ stage: 'transcribed', label: '文字稿已就绪，正在进行 AI 拆解' })
    const output = await processor.analyze(work.id, transcript, settings)
    onProgress?.({ stage: 'analyzed', label: 'AI 拆解已完成，正在保存结果' })
    return { transcript, ...output }
  }

  function cleanupManagedMedia(): void {
    try {
      const settings = repositories.settings.get<PublicSettings>('app.publicSettings')
      cleanupExpiredMedia(mediaDirectory, createMediaCleanupOptions({
        retentionDays: settings?.mediaRetentionDays,
        works: repositories.works.listAll(),
        jobs: repositories.jobs.list(),
        artifacts: repositories.artifacts.list()
      }))
    } catch {
      log.warn('Managed media cleanup failed', { errorCode: 'MEDIA_CLEANUP_FAILED' })
    }
  }

  const agentAccess = new AgentAccessService({ settings: repositories.settings, secrets })
  const agentAudits = new AgentAuditService(repositories.agentAudits)

  // Filled after AgentLifecycle is created below; ports use lazy access so the
  // runtime can run an Agent-based analysis without a lifecycle reference.
  const ports: RuntimePorts = {
    discover: (creatorId, profileUrl, ownership) => douyin.captureCreator(creatorId, profileUrl, ownership),
    processWork,
    login: () => douyin.login(),
    logout: () => douyin.logout(),
    isLoggedIn: () => douyin.isLoggedIn(),
    closeBrowser: async () => {
      const profileDirectory = join(userData, 'scrapling-browser-profile')
      await closeDedicatedBrowser(profileDirectory)
    },
    profileDirectory: join(userData, 'scrapling-browser-profile'),
    resolveCreatorInput: (input) => resolveDouyinCreatorUrl(input, createCreatorRedirectFetch()),
    saveApiKey: (providerId, apiKey) => secrets.set(`ai.${providerId}`, apiKey),
    getApiKeyConfiguredByProvider: () => Object.fromEntries(AI_PROVIDER_CATALOG.map((provider) => {
      try {
        return [provider.id, Boolean(secrets.get(`ai.${provider.id}`))]
      } catch {
        return [provider.id, false]
      }
    })),
    isModelConfigured: () => {
      const profile = modelProfiles.getActiveRuntimeProfile()
      return Boolean(profile && (!profile.requiresApiKey || profile.apiKey))
    },
    getActiveModelIdentity: () => {
      const profile = modelProfiles.list().find((item) => item.active)
      return profile ? { profileId: profile.id, providerId: profile.providerTemplate, modelId: profile.modelId } : null
    },
    clusterWeeklyTopics: async (works, settings) => {
      return clusterTopicsWithSelectedEngine(works, [], settings)
    },
    removeManagedMedia: async (workIds) => {
      for (const workId of workIds) {
        await rm(join(mediaDirectory, workId.replaceAll(':', '_')), { recursive: true, force: true })
      }
    },
    feishu,
    report: (level, message, detail) => log[level](message, detail ?? ''),
    detectAgentCli: (settings) => agentCliRunnerRef
      ? probeAgentCli(settings?.agentCliPath ?? '')
      : Promise.resolve(null),
    runAgentAnalysis: async (work, settings) => {
      if (!agentCliRunnerRef || !agentLifecycleRef) throw Object.assign(new Error('本地 Codex 引擎未就绪'), { code: 'AGENT_ENGINE_UNAVAILABLE' })
      // Download + transcribe first (shared with the cloud engine) so the
      // Codex always analyzes a real transcript, never an empty one.
      const transcript = await ensureTranscript(work)
      const agent = await probeAgentCli(settings.agentCliPath ?? '')
      if (!agent) throw Object.assign(new Error('未检测到 Codex CLI，请先安装并登录 Codex，然后到设置重新检测'), { code: 'AGENT_CLI_NOT_FOUND' })
      const result = await agentCliRunnerRef.run(agent, {
        workId: work.id,
        transcript,
        model: settings.agentModel,
        reasoningEffort: settings.agentReasoningEffort
      })
      if (!result.ok) {
        throw Object.assign(new Error(agentFailureMessage(result.errorCode)), {
          code: result.errorCode ?? 'AGENT_ANALYSIS_FAILED'
        })
      }
      if (!repositories.analyses.get(work.id)) {
        throw Object.assign(new Error(agentFailureMessage('AGENT_RESULT_MISSING')), {
          code: 'AGENT_RESULT_MISSING'
        })
      }
      // Codex writes through analysis.write itself; nothing more to do here.
    },
    agentAccess,
    agentRewrite: async (_workId, payload, settings) => {
      log.info('rewriteWork via agent: starting', {
        agentModel: settings.agentModel,
        title: payload.title,
        hasFollowUp: Boolean(payload.followUp)
      })
      // One-click rewrite through the local Codex CLI (selected via the top
      // bar). Ship the same Humanizer-zh prompt and read JSON from stdout.
      if (!agentCliRunnerRef) throw Object.assign(new Error('本地 Codex 引擎未就绪'), { code: 'AGENT_ENGINE_UNAVAILABLE' })
      const agent = await probeAgentCli(settings.agentCliPath ?? '')
      if (!agent) throw Object.assign(new Error('未检测到 Codex CLI，请先安装并登录 Codex，然后到设置重新检测'), { code: 'AGENT_CLI_NOT_FOUND' })
      const prompt = [
        buildSystemPrompt(payload.wordCount ?? 400),
        '',
        '## 用户输入(请基于此输出)',
        buildUserPrompt({
          source: {
            title: payload.title,
            topicAngle: payload.topicAngle,
            openingHookQuote: payload.openingHookQuote,
            openingHookType: payload.openingHookType,
            openingHookMechanism: payload.openingHookMechanism,
            structure: payload.structure,
            viralPoints: payload.viralPoints,
            highlights: payload.highlights,
            reusablePatterns: payload.reusablePatterns
          },
          userContext: payload.userContext,
          wordCount: payload.wordCount,
          followUp: payload.followUp
        }),
        '',
        `## 任务说明
请直接调用上述命令完成改写,并把结果以 JSON 形式返回(needMore/content/score 字段,格式见 system prompt)。只返回 JSON,不要解释。`
      ].join('\n')
      const result = await agentCliRunnerRef.runRewrite(agent, prompt, {
        model: settings.agentModel,
        reasoningEffort: settings.agentReasoningEffort
      })
      log.info('rewriteWork via agent: cli finished', {
        ok: result.ok,
        exitCode: result.exitCode,
        errorCode: result.errorCode,
        stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
        stdoutBytes: Buffer.byteLength(result.stdout, 'utf8')
      })
      if (!result.ok) {
        throw Object.assign(new Error(agentFailureMessage(result.errorCode)), {
          code: result.errorCode ?? 'AGENT_REWRITE_FAILED'
        })
      }
      const parsed = parseRewrite(result.stdout)
      log.info('rewriteWork via agent: parsed', {
        needMore: parsed.needMore,
        contentLen: parsed.content?.length ?? 0
      })
      return {
        needMore: parsed.needMore,
        questions: parsed.questions,
        content: parsed.content,
        score: parsed.score
      }
    },
    rewriteWork: async (_workId, payload) => {
      log.info('rewriteWork via cloud: starting', { title: payload.title })
      // Rewrite uses json_object response format for the quality score.
      // Bound the request to 90s so a hung upstream doesn't keep the user
      // waiting indefinitely with no feedback.
      const { client } = createAiClient(true, 90_000)
      const result = await new RewriteService(client).rewrite({
        source: {
          title: payload.title,
          topicAngle: payload.topicAngle,
          openingHookQuote: payload.openingHookQuote,
          openingHookType: payload.openingHookType,
          openingHookMechanism: payload.openingHookMechanism,
          structure: payload.structure,
          viralPoints: payload.viralPoints,
          highlights: payload.highlights,
          reusablePatterns: payload.reusablePatterns
        },
        userContext: payload.userContext,
        wordCount: payload.wordCount,
        followUp: payload.followUp
      })
      return {
        needMore: result.needMore,
        questions: result.questions,
        content: result.content,
        score: result.score
      }
    },
    onCodexSettingsChanged: () => invalidateEngineHealth('codex')
  }

  processor.analyzeSelected = async (workId, transcript, rawSettings) => {
    const settings = rawSettings as PublicSettings
    if (settings.runEngine !== 'local-agent') {
      return processor.analyze(workId, transcript, settings)
    }
    const work = repositories.works.get(workId)
    if (!work || !ports.runAgentAnalysis) {
      throw Object.assign(new Error('本地 Codex 引擎未就绪'), { code: 'AGENT_ENGINE_UNAVAILABLE' })
    }
    await ports.runAgentAnalysis(work, settings)
    const analysis = repositories.analyses.get(workId)
    if (!analysis) {
      throw Object.assign(new Error('Codex 未返回拆解结果'), { code: 'AGENT_ANALYSIS_RESULT_MISSING' })
    }
    return {
      result: analysis.result,
      provider: analysis.provider,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
      tokenUsage: analysis.tokenUsage
    }
  }

  let runtime: DesktopRuntime | null = null
  const requireRuntime = (): DesktopRuntime => {
    if (!runtime) throw new Error('RUNTIME_NOT_INITIALIZED')
    return runtime
  }
  const imports = new ImportService({
    repositories,
    mediaRoot: mediaDirectory,
    ingestLocal: ingestLocalFile,
    resolveDouyin: (url) => resolveDouyinVideo(url, douyin),
    download: (url, destination) => downloadMedia(url, destination, electronFetch),
    processor,
    getSettings: () => repositories.settings.get<PublicSettings>('app.publicSettings') ?? {},
    notification: options.notification,
    onLocalDataChanged: () => requireRuntime().markFeishuLocalChange(),
    afterSettled: async () => {
      await Promise.allSettled([
        Promise.resolve().then(cleanupManagedMedia),
        requireRuntime().flushFeishuAfterTask()
      ])
    },
    report: ports.report
  })
  imports.reconcileInterruptedJobs()
  cleanupManagedMedia()

  runtime = new DesktopRuntime(database, ports, imports, modelProfiles)
  const agentFacade: AgentApplicationFacade = new RuntimeAgentFacade(runtime, modelProfiles)
  const agentRegistry = createApplicationCapabilityRegistry(agentFacade, {
    appVersion: APP_VERSION,
    access: agentAccess
  })
  const agentLifecycle = new AgentLifecycle({
    registry: agentRegistry,
    access: agentAccess,
    audits: agentAudits
  })
  agentLifecycleRef = agentLifecycle
  agentCliRunnerRef = new AgentCliRunner({
    resolveCommand: async (command) => {
      // On Windows, .cmd wrappers (e.g. codex.cmd) only invoke the real .exe
      // when launched through cmd.exe. But cmd.exe with /c re-tokenizes the
      // command line and breaks on prompts whose first word starts with "-"
      // or contains a space. To avoid that fragility, walk the .cmd and
      // resolve the actual exe it forwards to, then spawn that exe directly
      // (no shell, no prompt re-tokenization).
      if (process.platform !== 'win32') return command
      if (!/\.(cmd|bat)$/i.test(command)) return command
      try {
        const { existsSync, readFileSync } = await import('node:fs')
        if (!existsSync(command)) return command
        const lines = readFileSync(command, 'utf8').split(/\r?\n/)
        // Look for: set "FOO_EXE=..."  or  set FOO=...EXE_PATH
        const exeVar = lines
          .map((line) => /set\s+"?([A-Z_]+EXE[A-Z_]*)"?\s*=\s*"?([^"\r\n]+)"?/i.exec(line))
          .find((m) => m !== null)
        if (!exeVar) return command
        const raw = exeVar[2]
        const resolved = raw.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`)
        if (existsSync(resolved)) return resolved
      } catch { /* fall through to original command */ }
      return command
    },
    getEndpoint: () => {
      const state = agentAccess.getState()
      const port = agentLifecycleRef?.getState().port
      if (!state.enabled || !port) return null
      return { port, token: agentAccess.ensureToken() }
    },
    timeoutMs: 5 * 60_000
  })
  const agentManager = new AgentManager({
    access: agentAccess,
    lifecycle: agentLifecycle
  })
  if (agentAccess.getState().enabled) {
    void agentLifecycle.start().catch(() => {
      log.warn('Local Agent service start failed', { errorCode: 'AGENT_SERVICE_START_FAILED' })
    })
  }
  const engineHealth = new EngineHealthService({
    settings: repositories.settings,
    cloud: {
      fingerprint: () => opaqueHealthFingerprint(modelProfiles.getActiveHealthIdentity()),
      probe: async () => {
        const result = await modelProfiles.testActiveConnection()
        return { ok: result.ok, code: result.errorCode === 'CONNECTION_FAILED' ? 'CLOUD_CONNECTION_FAILED' : result.errorCode }
      }
    },
    codex: {
      fingerprint: async () => {
        const settings = currentPublicSettings()
        const agent = await probeAgentCli(settings.agentCliPath ?? '')
        return opaqueHealthFingerprint({
          executable: agent ? { id: agent.id, command: agent.command, displayName: agent.displayName } : null,
          ...normalizedCodexHealthSettings(settings)
        })
      },
      probe: async () => {
        const settings = currentPublicSettings()
        const agent = await probeAgentCli(settings.agentCliPath ?? '')
        if (!agent || !agentCliRunnerRef) return { ok: false, code: 'CODEX_CLI_NOT_FOUND' }
        const result = await agentCliRunnerRef.testConnection(agent, normalizedCodexHealthSettings(settings))
        return { ok: result.ok, code: result.errorCode }
      }
    }
  })
  engineHealthRef = engineHealth

  return {
    runtime,
    modelProfiles,
    engineHealth,
    agentManager,
    agentLifecycle,
    detectAgentCli: (settings) => probeAgentCli(settings.agentCliPath ?? ''),
    rewriteWork: ports.rewriteWork ?? (() => Promise.reject(new Error('REWRITE_UNAVAILABLE'))),
    async close() {
      await agentLifecycle.stop()
      runtime.shutdown()
      await imports.shutdown()
      if (!runtime.isBusinessIdle()) {
        await new Promise<void>((resolve) => {
          const unsubscribe = runtime.onBusinessIdle(() => {
            unsubscribe()
            resolve()
          })
        })
      }
      database.close()
    }
  }

  function currentPublicSettings(): PublicSettings {
    return repositories.settings.get<PublicSettings>('app.publicSettings') ?? {}
  }

  function invalidateEngineHealth(engine: 'cloud' | 'codex'): void {
    const operation = engine === 'cloud'
      ? engineHealthRef?.invalidateCloud()
      : engineHealthRef?.invalidateCodex()
    void operation?.catch(() => {
      log.warn('Engine health invalidation failed', { errorCode: 'ENGINE_HEALTH_INVALIDATION_FAILED', engine })
    })
  }
}

function normalizedCodexHealthSettings(settings: PublicSettings): { model?: string, reasoningEffort?: PublicSettings['agentReasoningEffort'] } {
  const model = settings.agentModel?.trim()
  const reasoningEffort = settings.agentReasoningEffort
  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {})
  }
}

/**
 * Health state is renderer-visible and persisted. Keep configuration comparison
 * stable without storing paths or URLs (which can contain userinfo/query tokens).
 */
function opaqueHealthFingerprint(value: unknown): string {
  return `v1:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

/**
 * Restores the full Windows PATH into `env` when it is missing or partial.
 * Desktop-launched Electron processes may inherit an empty/partial PATH;
 * the real user+system PATH lives in the registry (HKCU + HKLM). We merge
 * both in so `where` lookups and spawned Agent CLIs resolve correctly.
 */
function ensureWindowsPath(env: NodeJS.ProcessEnv): void {
  const existing = (env.PATH ?? env.Path ?? '').trim()
  if (existing && existing.split(';').length >= 5) return // already looks complete
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  const readPath = (key: string): string | null => {
    try {
      const raw = execFileSync('reg', [
        'query', key, '/v', 'Path'
      ], { encoding: 'utf8', windowsHide: true })
      const match = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(raw)
      if (!match?.[1]) return null
      return match[1].trim().replace(/%SystemRoot%/gi, env.SystemRoot ?? 'C:\\Windows')
    } catch { return null }
  }
  const userPath = readPath('HKCU\\Environment')
  const systemPath = readPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
  const parts = [systemPath, existing, userPath].filter(Boolean)
  if (parts.length > 0) env.PATH = parts.join(';')
}

/**
 * Detects Codex CLI. Defaults to auto-detection (known install path, where).
 * An optional manual Codex path overrides auto-detection when set.
 */
export function classifyAgentCliWhereFailure(error: unknown): false {
  const status = error && typeof error === 'object' && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  if (status === 1) return false
  throw new Error('AGENT_CLI_PROBE_FAILED')
}

function probeAgentCli(manualCliPath: string): Promise<DetectedAgentCli | null> {
  const probe = detectAgentCli({
    commandExists: async (command, bareName) => {
      const looksAbsolute = command.includes('\\') || command.includes('/')
      if (existsSync(command)) return true
      if (looksAbsolute) return false
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
        const stdout = execFileSync('where', [bareName], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim()
        return Boolean(stdout)
      } catch (error) {
        return classifyAgentCliWhereFailure(error)
      }
    }
  }, {
    ...process.env,
    CONTENT_RADAR_AGENT_CLI: (manualCliPath ?? '').trim()
  })
  return probe
}

function loadBundledScraplingSource(): ScraplingBundledSource {
  const root = join(process.resourcesPath, 'scrapling-engine')
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) throw scraplingBundleUnavailable()
  let manifest: ReturnType<typeof parseScraplingEngineManifest>
  try {
    manifest = parseScraplingEngineManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  } catch (error) {
    if (isScraplingManifestError(error)) throw error
    throw scraplingManifestInvalid()
  }
  const archivePath = join(root, manifest.archive.filename)
  if (!existsSync(archivePath)) throw scraplingBundleUnavailable()
  return {
    manifest,
    archivePath
  }
}

function isScraplingManifestError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  return code === 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED' || code === 'SCRAPLING_ENGINE_MANIFEST_INVALID'
}

function scraplingManifestInvalid(): Error & { code: string, retryable: boolean } {
  return Object.assign(new Error('SCRAPLING_ENGINE_MANIFEST_INVALID'), {
    code: 'SCRAPLING_ENGINE_MANIFEST_INVALID', retryable: false
  })
}

function scraplingBundleUnavailable(): Error & { code: string, retryable: boolean } {
  return Object.assign(new Error('SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE'), {
    code: 'SCRAPLING_ENGINE_BUNDLE_UNAVAILABLE', retryable: false
  })
}
