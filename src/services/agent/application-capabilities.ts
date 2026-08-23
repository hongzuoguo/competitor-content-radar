import { z } from 'zod'
import type { AgentAccessService } from './agent-access-service'
import { AgentCapabilityError } from './agent-contract'
import { CapabilityRegistry } from './capability-registry'
import type { AgentInvocationContext } from './agent-contract'
import { ContentKeywordsSchema, TopicCategorySchema } from '../ai/analysis-schema'

export interface AgentApplicationFacade {
  getDashboard(): Promise<unknown>
  listCreators(): Promise<unknown>
  listWorks(): Promise<unknown>
  getWork(id: string): Promise<unknown>
  listRuns(): Promise<unknown>
  getSettings(): Promise<unknown>
  runNow(): Promise<unknown>
  addCreator(url: string): Promise<unknown>
  toggleCreator(id: string, enabled: boolean): Promise<void>
  analyzeWork(id: string): Promise<unknown>
  deleteCreator(id: string): Promise<void>
  deleteRun(id: string): Promise<void>
  clearUnclassifiedWorks(): Promise<void>
  listModelProfiles(): Promise<unknown>
  getModelProfile(id: string): Promise<unknown>
  createModelProfile(input: unknown, apiKey?: string): Promise<unknown>
  updateModelProfile(id: string, input: unknown, apiKey?: string): Promise<unknown>
  setActiveModelProfile(id: string): Promise<unknown>
  setModelProfileApiKey(id: string, apiKey: string): Promise<void>
  deleteModelProfileApiKey(id: string): Promise<void>
  testModelProfileConnection(input: unknown, apiKey?: string, profileId?: string): Promise<unknown>
  deleteModelProfile(id: string): Promise<void>
  resetAgentToken(): Promise<string>
  startImport(request: unknown): Promise<unknown>
  retryImport(workId: string): Promise<unknown>
  retryRun(id: string): Promise<unknown>
  listPendingItems(): Promise<unknown>
  saveSettings(input: unknown): Promise<unknown>
  writeAnalysis(input: unknown): Promise<unknown>
}

export interface ApplicationCapabilityRegistryOptions {
  appVersion: string
  access: AgentAccessService
}

const AgentAnalysisWriteSchema = z.object({
  workId: z.string().min(1),
  category: TopicCategorySchema,
  keywords: ContentKeywordsSchema,
  angle: z.string().min(1),
  hook: z.string().min(1),
  structure: z.array(z.string().min(1)).min(1),
  explosion: z.array(z.string().min(1)),
  highlights: z.array(z.string().min(1)),
  reusablePatterns: z.array(z.string().min(1)).optional(),
  differentiatedSuggestions: z.object({
    angles: z.array(z.string().min(1)).optional(),
    titles: z.array(z.string().min(1)).optional(),
    openings: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional()
  }).optional(),
  modelId: z.string().min(1),
  schemaVersion: z.string().min(1)
})

const ModelProfileInput = z.object({
  name: z.string().trim().min(1).max(80),
  providerTemplate: z.enum(['deepseek', 'doubao', 'kimi', 'qwen', 'custom']),
  baseUrl: z.string().trim().min(1),
  modelId: z.string().trim().min(1).max(160),
  requiresApiKey: z.boolean(),
  enabled: z.boolean()
})

export function createApplicationCapabilityRegistry(
  facade: AgentApplicationFacade,
  options: ApplicationCapabilityRegistryOptions
): CapabilityRegistry {
  const registry = new CapabilityRegistry({ appVersion: options.appVersion })
  const empty = z.object({})

  registerRead(registry, 'app.status', 'Read application dashboard and service status.', empty, () => facade.getDashboard())
  registerRead(registry, 'creators.list', 'List monitored creators.', empty, () => facade.listCreators())
  registerRead(registry, 'works.list', 'List collected works and processing states.', empty, () => facade.listWorks())
  registerRead(registry, 'works.get', 'Read one work including transcript and analysis when available.', z.object({ id: z.string().min(1) }), ({ id }) => facade.getWork(id))
  registerRead(registry, 'works.pending', 'List works waiting for transcript or analysis.', empty, () => facade.listPendingItems())
  registerRead(registry, 'runs.list', 'List collection and analysis runs.', empty, () => facade.listRuns())
  registerRead(registry, 'settings.get', 'Read sanitized application settings. API keys are never returned.', empty, () => facade.getSettings())
  registerRead(registry, 'modelProfiles.list', 'List saved model profiles without API key plaintext.', empty, () => facade.listModelProfiles())
  registerRead(registry, 'modelProfiles.get', 'Read one model profile without API key plaintext.', z.object({ id: z.string().min(1) }), ({ id }) => facade.getModelProfile(id))

  registry.register({
    name: 'runs.start',
    description: 'Start collection and analysis now.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: empty,
    outputSchema: z.unknown(),
    handler: () => facade.runNow()
  })
  registry.register({
    name: 'creators.add',
    description: 'Add a monitored creator from a Douyin profile URL or shared card text.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ input: z.string().min(1) }),
    outputSchema: z.unknown(),
    handler: ({ input }) => facade.addCreator(input)
  })
  registry.register({
    name: 'creators.toggle',
    description: 'Enable or pause monitoring for a creator.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
    outputSchema: z.object({ ok: z.literal(true) }),
    handler: async ({ id, enabled }) => {
      await facade.toggleCreator(id, enabled)
      return { ok: true as const }
    }
  })
  registry.register({
    name: 'works.analyze',
    description: 'Run application-managed AI analysis for one work.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1) }),
    outputSchema: z.unknown(),
    handler: ({ id }) => facade.analyzeWork(id)
  })
  registry.register({
    name: 'imports.start',
    description: 'Start importing one local video or a Douyin single-work share link.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ request: z.unknown() }),
    outputSchema: z.unknown(),
    handler: ({ request }) => facade.startImport(request)
  })
  registry.register({
    name: 'imports.retry',
    description: 'Retry a failed single-work import.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ workId: z.string().min(1) }),
    outputSchema: z.unknown(),
    handler: ({ workId }) => facade.retryImport(workId)
  })
  registry.register({
    name: 'runs.retry',
    description: 'Retry a failed run, or resynchronize when only Feishu failed.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1) }),
    outputSchema: z.unknown(),
    handler: ({ id }) => facade.retryRun(id)
  })
  registry.register({
    name: 'settings.save',
    description: 'Update application settings that change future run behavior.',
    permission: 'settings.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ settings: z.unknown() }),
    outputSchema: z.unknown(),
    handler: ({ settings }) => facade.saveSettings(settings)
  })
  registry.register({
    name: 'modelProfiles.create',
    description: 'Create a model profile. Optionally provide an API key; plaintext keys are never returned.',
    permission: 'settings.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ profile: ModelProfileInput, apiKey: z.string().optional() }),
    outputSchema: z.unknown(),
    handler: ({ profile, apiKey }) => facade.createModelProfile(profile, apiKey)
  })
  registry.register({
    name: 'modelProfiles.update',
    description: 'Update a model profile. Optionally provide a replacement API key.',
    permission: 'settings.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1), profile: ModelProfileInput, apiKey: z.string().optional() }),
    outputSchema: z.unknown(),
    handler: ({ id, profile, apiKey }) => facade.updateModelProfile(id, profile, apiKey)
  })
  registry.register({
    name: 'modelProfiles.setActive',
    description: 'Make one model profile the active default for future analysis.',
    permission: 'settings.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1) }),
    outputSchema: z.unknown(),
    handler: ({ id }) => facade.setActiveModelProfile(id)
  })
  registry.register({
    name: 'modelProfiles.setApiKey',
    description: 'Set or replace the API key for one model profile. The key is encrypted locally.',
    permission: 'security.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1), apiKey: z.string().min(1) }),
    outputSchema: z.object({ ok: z.literal(true) }),
    handler: async ({ id, apiKey }) => {
      await facade.setModelProfileApiKey(id, apiKey)
      return { ok: true as const }
    }
  })
  registry.register({
    name: 'modelProfiles.deleteApiKey',
    description: 'Remove the stored API key for one model profile.',
    permission: 'security.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ id: z.string().min(1) }),
    outputSchema: z.object({ ok: z.literal(true) }),
    handler: async ({ id }) => {
      await facade.deleteModelProfileApiKey(id)
      return { ok: true as const }
    }
  })
  registry.register({
    name: 'modelProfiles.test',
    description: 'Test a model profile connection without saving it.',
    permission: 'settings.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: z.object({ profile: ModelProfileInput, apiKey: z.string().optional(), profileId: z.string().optional() }),
    outputSchema: z.unknown(),
    handler: ({ profile, apiKey, profileId }) => facade.testModelProfileConnection(profile, apiKey, profileId)
  })
  registry.register({
    name: 'analysis.write',
    description: 'Write structured analysis with a concrete creative direction and complete topic keywords from the local Agent. Does not overwrite an existing valid analysis when the payload is invalid.',
    permission: 'data.write',
    risk: 'write',
    minimumApiVersion: 'v1',
    inputSchema: AgentAnalysisWriteSchema,
    outputSchema: z.unknown(),
    handler: (input) => facade.writeAnalysis(input)
  })

  registerDangerous(registry, 'creators.delete', 'Permanently delete a creator and its works.', z.object({ id: z.string().min(1) }), ({ id }) => facade.deleteCreator(id), options.access)
  registerDangerous(registry, 'runs.delete', 'Delete a run log. Works, transcripts and analyses are kept.', z.object({ id: z.string().min(1) }), ({ id }) => facade.deleteRun(id), options.access)
  registerDangerous(registry, 'works.clearUnclassified', 'Delete all unclassified imported works.', empty, () => facade.clearUnclassifiedWorks(), options.access)
  registerDangerous(registry, 'modelProfiles.delete', 'Permanently delete a model profile and its stored key.', z.object({ id: z.string().min(1) }), ({ id }) => facade.deleteModelProfile(id), options.access)
  registerDangerous(registry, 'agent.resetToken', 'Regenerate the local Agent access token. The old token stops working immediately.', empty, () => facade.resetAgentToken(), options.access)

  return registry
}

function registerRead<TInput>(
  registry: CapabilityRegistry,
  name: string,
  description: string,
  inputSchema: z.ZodType<TInput>,
  handler: (input: TInput) => Promise<unknown>
): void {
  registry.register({
    name,
    description,
    permission: 'data.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema,
    outputSchema: z.unknown(),
    handler
  })
}

function registerDangerous<TInput>(
  registry: CapabilityRegistry,
  name: string,
  description: string,
  inputSchema: z.ZodType<TInput>,
  handler: (input: TInput) => Promise<unknown>,
  access: AgentAccessService
): void {
  registry.register({
    name,
    description,
    permission: 'data.delete',
    risk: 'dangerous',
    minimumApiVersion: 'v1',
    inputSchema,
    outputSchema: z.unknown(),
    handler: async (input, context) => {
      if (!context.confirmationToken) {
        const confirmation = access.issueConfirmation(name, input)
        return { confirmation, summary: description, requiresConfirmation: true }
      }
      if (!access.consumeConfirmation(context.confirmationToken, name, input)) {
        throw new AgentCapabilityError('AGENT_CONFIRMATION_REQUIRED', 'Confirmation token is invalid, expired or reused. Start the operation again to receive a new token.')
      }
      await handler(input)
      return { ok: true as const }
    }
  })
}
