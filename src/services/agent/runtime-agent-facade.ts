import type { DesktopRuntime } from '../../main/runtime'
import type { AnalysisRecord } from '../database/repositories'
import type { AgentApplicationFacade } from './application-capabilities'

const AGENT_ANALYSIS_SCHEMA_VERSION = 'v2'

/**
 * Adapts the production runtime and model profile service to the narrow
 * facade used by the Agent capability registry. Never returns API key
 * plaintext and never accepts free-form SQL, file system or shell access.
 */
export class RuntimeAgentFacade implements AgentApplicationFacade {
  constructor(
    private readonly runtime: DesktopRuntime,
    private readonly modelProfiles: NonNullable<DesktopRuntime['modelProfiles']>
  ) {}

  getDashboard(): Promise<unknown> {
    return this.runtime.getDashboard()
  }

  listCreators(): Promise<unknown> {
    return this.runtime.listCreators()
  }

  listWorks(): Promise<unknown> {
    return this.runtime.listWorks()
  }

  getWork(id: string): Promise<unknown> {
    return this.runtime.getWork(id)
  }

  listRuns(): Promise<unknown> {
    return this.runtime.listRuns()
  }

  getSettings(): Promise<unknown> {
    return this.runtime.getSettings()
  }

  runNow(): Promise<unknown> {
    return this.runtime.runNow('manual')
  }

  addCreator(url: string): Promise<unknown> {
    return this.runtime.addCreator(url)
  }

  toggleCreator(id: string, enabled: boolean): Promise<void> {
    return this.runtime.toggleCreator(id, enabled)
  }

  analyzeWork(id: string): Promise<unknown> {
    return this.runtime.analyzeWork(id)
  }

  deleteCreator(id: string): Promise<void> {
    return this.runtime.deleteCreator(id)
  }

  deleteRun(id: string): Promise<void> {
    return this.runtime.deleteRun(id)
  }

  clearUnclassifiedWorks(): Promise<void> {
    return this.runtime.clearUnclassifiedWorks()
  }

  async listModelProfiles(): Promise<unknown> {
    return this.modelProfiles.list()
  }

  async getModelProfile(id: string): Promise<unknown> {
    return this.modelProfiles.get(id)
  }

  createModelProfile(input: unknown, apiKey?: string): Promise<unknown> {
    return Promise.resolve(this.modelProfiles.create(input as never, apiKey))
  }

  updateModelProfile(id: string, input: unknown, apiKey?: string): Promise<unknown> {
    return Promise.resolve(this.modelProfiles.update(id, input as never, apiKey))
  }

  setActiveModelProfile(id: string): Promise<unknown> {
    return Promise.resolve(this.modelProfiles.setActive(id))
  }

  setModelProfileApiKey(id: string, apiKey: string): Promise<void> {
    this.modelProfiles.setApiKey(id, apiKey)
    return Promise.resolve()
  }

  deleteModelProfileApiKey(id: string): Promise<void> {
    this.modelProfiles.deleteApiKey(id)
    return Promise.resolve()
  }

  testModelProfileConnection(input: unknown, apiKey?: string, profileId?: string): Promise<unknown> {
    return this.modelProfiles.testConnection(input as never, apiKey, profileId)
  }

  deleteModelProfile(id: string): Promise<void> {
    this.modelProfiles.delete(id)
    return Promise.resolve()
  }

  resetAgentToken(): Promise<string> {
    return this.runtime.resetAgentAccessToken()
  }

  startImport(request: unknown): Promise<unknown> {
    return this.runtime.startImport(request as never)
  }

  retryImport(workId: string): Promise<unknown> {
    return this.runtime.retryImport(workId)
  }

  retryRun(id: string): Promise<unknown> {
    return this.runtime.retryRun(id)
  }

  async listPendingItems(): Promise<unknown> {
    const works = await this.runtime.listWorks()
    return (works as Array<{ id: string; status: string; stage: string }>)
      .filter((work) => work.status === 'pending' || work.status === 'failed')
      .map((work) => ({ id: work.id, stage: work.stage, status: work.status }))
  }

  saveSettings(input: unknown): Promise<unknown> {
    return this.runtime.saveSettings(input as never)
  }

  async writeAnalysis(input: unknown): Promise<unknown> {
    const payload = input as {
      workId: string
      category: string
      keywords: string[]
      angle: string
      hook: string
      structure: string[]
      explosion: string[]
      highlights: string[]
      reusablePatterns?: string[]
      differentiatedSuggestions?: {
        angles?: string[]
        titles?: string[]
        openings?: string[]
        risks?: string[]
      }
      modelId: string
      schemaVersion: string
    }
    const work = await this.runtime.getWork(payload.workId)
    if (!work) throw new Error('WORK_NOT_FOUND')
    const existing = await this.runtime.getStoredAnalysis(payload.workId)
    if (existing && existing.provider !== 'local-agent') {
      throw new Error('ANALYSIS_EXISTS_AND_VALID')
    }
    const record: AnalysisRecord = {
      workId: payload.workId,
      transcript: existing?.transcript ?? (work as { transcript: string | null }).transcript ?? '',
      result: {
        topicCategory: payload.category,
        contentKeywords: payload.keywords,
        topicAngle: payload.angle,
        openingHook: { quote: payload.hook, type: 'agent', mechanism: 'agent' },
        structure: payload.structure,
        viralPoints: payload.explosion,
        highlights: payload.highlights,
        reusablePatterns: payload.reusablePatterns ?? [],
        differentiatedSuggestions: {
          angles: payload.differentiatedSuggestions?.angles ?? [],
          titles: payload.differentiatedSuggestions?.titles ?? [],
          openings: payload.differentiatedSuggestions?.openings ?? [],
          risks: payload.differentiatedSuggestions?.risks ?? []
        }
      },
      provider: 'local-agent',
      model: payload.modelId,
      promptVersion: payload.schemaVersion || AGENT_ANALYSIS_SCHEMA_VERSION,
      tokenUsage: null,
      createdAt: new Date().toISOString()
    }
    this.runtime.saveAgentAnalysis(record)
    return { ok: true, workId: payload.workId }
  }
}
