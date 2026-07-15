import { app } from 'electron'
import log from 'electron-log/main'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppDatabase } from '../services/database/database'
import { AppRepositories } from '../services/database/repositories'
import { DouyinBrowserSession } from '../services/douyin/session'
import { downloadMedia } from '../services/media/downloader'
import { extractWav } from '../services/media/ffmpeg'
import { cleanupExpiredMedia, createMediaCleanupOptions } from '../services/media/cleanup'
import { ModelManager, type ModelFileManifest } from '../services/asr/model-manager'
import { transcribeWithSenseVoice } from '../services/asr/sensevoice'
import { SecretStore } from '../services/secrets/secret-store'
import { AI_PROVIDER_CATALOG } from '../services/ai/provider-catalog'
import { OpenAiCompatibleClient } from '../services/ai/openai-compatible'
import { AnalysisService } from '../services/ai/analysis-service'
import { ANALYSIS_PROMPT_VERSION } from '../services/ai/prompt'
import { DesktopRuntime, type ProcessedWork, type RuntimePorts } from './runtime'
import type { Work } from '../core/domain'
import type { PublicSettings } from '../shared/ipc-contract'
import { ImportService, type ImportNotificationPort, type WorkProcessor } from '../services/import/import-service'
import { ingestLocalFile } from '../services/import/local-file-source'
import { resolveDouyinVideo } from '../services/import/douyin-video-source'
import { resolveDouyinCreatorUrl } from '../services/douyin/creator-url'
import { createCreatorRedirectFetch } from './creator-redirect-request'
import { GetBijiClient } from '../services/get-biji/client'
import { ScraplingEngineManager } from '../services/scrapling-engine/manager'
import { ScraplingEngineRunner } from '../services/scrapling-engine/runner'
import { ScraplingFallbackCollector } from '../services/scrapling-engine/fallback-collector'

interface ModelManifest {
  id: string
  files: Record<string, ModelFileManifest>
}

export interface ProductionRuntime {
  runtime: DesktopRuntime
  close(): Promise<void>
}

export interface ProductionRuntimeOptions {
  notification?: ImportNotificationPort
}

export function createProductionRuntime(options: ProductionRuntimeOptions = {}): ProductionRuntime {
  const userData = app.getPath('userData')
  const mediaDirectory = join(userData, 'media')
  const database = new AppDatabase(join(userData, 'content-radar.db'))
  const repositories = new AppRepositories(database.connection)
  const secrets = new SecretStore(repositories.settings)
  const douyin = new DouyinBrowserSession()
  const scraplingFallback = new ScraplingFallbackCollector(
    new ScraplingEngineManager(join(userData, 'components')),
    new ScraplingEngineRunner(),
    join(userData, 'scrapling-browser-profile'),
    (message, detail) => log.info(message, detail ?? '')
  )
  const modelManifest = JSON.parse(
    readFileSync(join(app.getAppPath(), 'resources', 'model-manifest.json'), 'utf8')
  ) as ModelManifest
  const modelDirectory = join(userData, 'models', modelManifest.id)
  const modelManager = new ModelManager()
  let modelReady: Promise<void> | null = null

  function ensureModel(): Promise<void> {
    modelReady ??= Promise.all(
      Object.entries(modelManifest.files).map(([name, manifest]) => {
        return modelManager.ensureFile(manifest, join(modelDirectory, name))
      })
    ).then(() => undefined).catch((error) => {
      modelReady = null
      throw error
    })
    return modelReady
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
      await ensureModel()
      return transcribeWithSenseVoice(wavPath, modelDirectory)
    },
    async analyze(_workId, transcript, rawSettings) {
      const settings = rawSettings as PublicSettings
      if (!settings.providerId || !settings.modelId) throw new Error('AI_SETTINGS_MISSING')
      const provider = AI_PROVIDER_CATALOG.find((item) => item.id === settings.providerId)
      const baseUrl = settings.customBaseUrl || provider?.baseUrl
      if (!baseUrl) throw new Error('AI_BASE_URL_MISSING')
      const apiKey = secrets.get(`ai.${settings.providerId}`)
      if (!apiKey) throw new Error('AI_API_KEY_MISSING')
      const client = new OpenAiCompatibleClient({ baseUrl, apiKey, model: settings.modelId })
      const output = await new AnalysisService(client).analyze(transcript)
      return {
        result: output.analysis, provider: settings.providerId, model: settings.modelId,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        tokenUsage: { input: output.usage.inputTokens, output: output.usage.outputTokens }
      }
    }
  }

  async function processWork(work: Work, settings: PublicSettings): Promise<ProcessedWork> {
    const savedTranscript = repositories.artifacts.get(work.id)?.transcript
    if (savedTranscript) {
      const output = await processor.analyze(work.id, savedTranscript, settings)
      repositories.jobs.saveStage(work.id, 'analyzed')
      repositories.jobs.saveStage(work.id, 'completed')
      return { transcript: savedTranscript, ...output }
    }
    if (!work.downloadUrl) throw Object.assign(new Error('作品没有可用的公开下载地址'), {
      code: 'DOUYIN_MEDIA_URL_MISSING', retryable: false
    })
    const workDirectory = join(mediaDirectory, work.id.replaceAll(':', '_'))
    const videoPath = join(workDirectory, 'video.mp4')
    await downloadMedia(work.downloadUrl, videoPath)
    repositories.jobs.saveStage(work.id, 'downloaded')
    const wavPath = await processor.extractAudio(work.id, videoPath)
    repositories.jobs.saveStage(work.id, 'audio_extracted')
    const transcript = await processor.transcribe(work.id, wavPath)
    repositories.jobs.saveStage(work.id, 'transcribed')
    const output = await processor.analyze(work.id, transcript, settings)
    repositories.jobs.saveStage(work.id, 'analyzed')
    repositories.jobs.saveStage(work.id, 'completed')
    return {
      transcript,
      ...output
    }
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

  const ports: RuntimePorts = {
    discover: (creatorId, profileUrl) => scraplingFallback.capture(
      creatorId,
      profileUrl,
      (id, url) => douyin.captureCreatorWorks(id, url)
    ),
    discoverFromGetBiji: async (creatorId, profileUrl, settings) => {
      const followId = profileUrl.startsWith('getbiji://blogger/')
        ? decodeURIComponent(profileUrl.slice('getbiji://blogger/'.length))
        : null
      if (!followId) return []
      const client = createGetBijiClient(settings)
      const contents = await client.listContents(followId)
      const works = []
      for (const content of contents) {
        const detail = await client.getContentDetail(content.postId)
        works.push({
          id: `getbiji:${content.postId}`, creatorId, platformWorkId: content.postId,
          sourceType: 'douyin_monitor' as const, sourceKey: `getbiji:${content.postId}`,
          mediaPath: null, title: content.title, publishedAt: content.publishedAt,
          originalUrl: detail.originalUrl ?? content.originalUrl, downloadUrl: null,
          metrics: content.metrics, transcript: detail.transcript
        })
      }
      return works
    },
    processWork,
    login: () => douyin.openLoginWindow(),
    resolveCreatorInput: (input) => resolveDouyinCreatorUrl(input, createCreatorRedirectFetch()),
    saveApiKey: (providerId, apiKey) => secrets.set(`ai.${providerId}`, apiKey),
    saveGetBijiApiKey: (apiKey) => secrets.set('get-biji.apiKey', apiKey),
    syncCreators: async (settings) => {
      if (settings.contentSource !== 'get_biji') return []
      const bloggers = await createGetBijiClient(settings).listBloggers()
      return bloggers.map((blogger) => ({
        id: `getbiji:${blogger.followId}`, platform: 'douyin' as const, name: blogger.name,
        profileUrl: `getbiji://blogger/${encodeURIComponent(blogger.followId)}`,
        enabled: true, createdAt: new Date().toISOString()
      }))
    },
    report: (level, message, detail) => log[level](message, detail ?? '')
  }

  function createGetBijiClient(settings: PublicSettings): GetBijiClient {
    const apiKey = secrets.get('get-biji.apiKey')
    if (!settings.getBijiClientId || !settings.getBijiTopicId || !apiKey) {
      throw Object.assign(new Error('请先在设置中填写得到大脑专题 ID、Client ID 和 API Key。'), {
        code: 'GET_BIJI_SETTINGS_MISSING'
      })
    }
    return new GetBijiClient({ clientId: settings.getBijiClientId, topicId: settings.getBijiTopicId, apiKey })
  }
  const imports = new ImportService({
    repositories,
    mediaRoot: mediaDirectory,
    ingestLocal: ingestLocalFile,
    resolveDouyin: (url) => resolveDouyinVideo(url, douyin),
    download: downloadMedia,
    processor,
    getSettings: () => repositories.settings.get<PublicSettings>('app.publicSettings') ?? {},
    notification: options.notification,
    afterSettled: cleanupManagedMedia,
    report: ports.report
  })
  imports.reconcileInterruptedJobs()
  cleanupManagedMedia()
  const runtime = new DesktopRuntime(database, ports, imports)
  return {
    runtime,
    async close() {
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
}
