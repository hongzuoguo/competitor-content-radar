import { ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { APP_METADATA } from '../shared/app-metadata'
import { extractDouyinWorkUrl } from '../shared/douyin-work-url'
import { IPC_CHANNELS, isFeishuSyncMode, type AgentCliDetectedView, type CreatorView, type DashboardData, type DeleteFailedWorkInvokeResult, type EngineHealthView, type FeishuConnectionView, type FeishuCustomAppConnectionInput, type ImportInvokeResult, type ImportRequest, type ImportStartResult, type IpcResult, type ManualAnalysisResult, type PublicSettings, type RewriteRequestView, type RewriteResultView, type RunHistoryItem, type RunStartResult, type SettingsInput, type TargetedCreatorRetryRequest, type UpdateState, type WorkDetail, type WorkListItem } from '../shared/ipc-contract'
import { ModelProfileInputSchema, type ModelProfileInput } from '../services/ai/model-profile'
import { AI_PROVIDER_CATALOG } from '../services/ai/provider-catalog'
import type { ActiveModelHealthIdentity, ConnectionTestResult, ModelProfileService, ModelProfileView } from '../services/ai/model-profile-service'
import type { AgentManager } from '../services/agent/agent-manager'
import type { EngineHealthService } from '../services/ai/engine-health-service'
import { toFeishuUserError } from '../services/feishu/user-error'

export interface IpcDependencies {
  getDashboard(): Promise<DashboardData>
  runNow(): Promise<{ accepted: boolean; reason?: string }>
  listRuns(): Promise<RunHistoryItem[]>
  retryRun(id: string): Promise<{ accepted: boolean; reason?: string }>
  retryFailedCreators(request: TargetedCreatorRetryRequest): Promise<RunStartResult>
  deleteRun(id: string): Promise<void>
  listCreators(): Promise<CreatorView[]>
  addCreator(input: string | { url: string; ownership: 'mine' }): Promise<CreatorView>
  deleteCreator(id: string): Promise<void>
  toggleCreator(id: string, enabled: boolean): Promise<void>
  clearUnclassifiedWorks(): Promise<void>
  loginDouyin(): Promise<void>
  logoutDouyin(): Promise<void>
  checkDouyinLogin(): Promise<{ loggedIn: boolean }>
  getSettings(): Promise<PublicSettings>
  saveSettings(settings: SettingsInput): Promise<PublicSettings>
  restoreRecommendedBehaviorSettings(): Promise<PublicSettings>
  startImport(request: ImportRequest): Promise<ImportStartResult>
  retryImport(workId: string): Promise<ImportStartResult>
  deleteFailedWork(workId: string): Promise<void>
  listWorks(): Promise<WorkListItem[]>
  getWork(id: string): Promise<WorkDetail | null>
  analyzeWork(id: string): Promise<ManualAnalysisResult>
  getFeishuConnection(): Promise<FeishuConnectionView>
  connectFeishuCustomApp(input: FeishuCustomAppConnectionInput): Promise<FeishuConnectionView>
  disconnectFeishu(): Promise<void>
  syncFeishu(): Promise<FeishuConnectionView>
  repairFeishu(selectedAppToken?: string): Promise<FeishuConnectionView>
  recreateFeishu(): Promise<FeishuConnectionView>
  openFeishuBase(): Promise<void>
  openFeishuDeveloperConsole(): Promise<void>
  modelProfiles?: Pick<ModelProfileService, 'list' | 'create' | 'update' | 'testConnection' | 'setActive' | 'delete' | 'setApiKey' | 'deleteApiKey'>
    & Partial<Pick<ModelProfileService, 'get' | 'getActiveHealthIdentity'>>
  engineHealth?: Pick<EngineHealthService, 'peekPersisted' | 'get' | 'refreshAll'> & Partial<Pick<EngineHealthService, 'recordCloudSuccess'>>
  agentManager?: AgentManager
  /** Probes for an installed Codex CLI, honoring settings.agentCliPath. */
  detectAgentCli?: (settings: PublicSettings) => Promise<AgentCliDetectedView | null>
  /** Rewrites a competitor's article using Humanizer-zh rules + user context. */
  rewriteWork?: (workId: string, payload: RewriteRequestView) => Promise<RewriteResultView>
}

export interface AgentManagerLike {
  getStatus(): unknown
}

export interface UpdateIpcDependencies {
  getState(): UpdateState
  retry(): Promise<void>
}

export function registerUpdateIpcHandlers(updates?: UpdateIpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.updateGet, async () => updates?.getState() ?? { status: 'idle' })
  ipcMain.handle(IPC_CHANNELS.updateRetry, async () => updates?.retry())
}

export interface FileDialog {
  showOpenDialog(options: {
    properties: ['openFile']
    filters: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

export function registerIpcHandlers(dependencies: IpcDependencies, _updates?: UpdateIpcDependencies, dialog?: FileDialog): void {
  let cloudTestTicket: CloudTestTicket | null = null
  ipcMain.handle(IPC_CHANNELS.dashboard, () => dependencies.getDashboard())
  ipcMain.handle(IPC_CHANNELS.runNow, () => dependencies.runNow())
  ipcMain.handle(IPC_CHANNELS.runList, () => dependencies.listRuns())
  ipcMain.handle(IPC_CHANNELS.runRetry, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_RUN_RETRY')
    return dependencies.retryRun(id.trim())
  })
  ipcMain.handle(IPC_CHANNELS.runRetryCreators, (_event, value: unknown) => (
    dependencies.retryFailedCreators(parseTargetedCreatorRetry(value))
  ))
  ipcMain.handle(IPC_CHANNELS.runDelete, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_RUN_DELETE')
    return dependencies.deleteRun(id.trim())
  })
  ipcMain.handle(IPC_CHANNELS.creatorList, () => dependencies.listCreators())
  ipcMain.handle(IPC_CHANNELS.creatorAdd, (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('INVALID_CREATOR_URL')
    return dependencies.addCreator(url)
  })
  ipcMain.handle(IPC_CHANNELS.creatorAddMine, (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('INVALID_CREATOR_URL')
    return dependencies.addCreator({ url, ownership: 'mine' })
  })
  ipcMain.handle(IPC_CHANNELS.creatorDelete, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('INVALID_CREATOR_DELETE')
    return dependencies.deleteCreator(id)
  })
  ipcMain.handle(IPC_CHANNELS.creatorToggle, (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('INVALID_CREATOR_TOGGLE')
    return dependencies.toggleCreator(id, enabled)
  })
  ipcMain.handle(IPC_CHANNELS.sourceClearUnclassified, () => dependencies.clearUnclassifiedWorks())
  ipcMain.handle(IPC_CHANNELS.douyinLogin, () => dependencies.loginDouyin())
  ipcMain.handle(IPC_CHANNELS.douyinLogout, () => dependencies.logoutDouyin())
  ipcMain.handle(IPC_CHANNELS.douyinCheckLogin, () => dependencies.checkDouyinLogin())
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => dependencies.getSettings())
  ipcMain.handle(IPC_CHANNELS.settingsSave, (_event, settings: unknown): Promise<PublicSettings> => {
    if (!settings || typeof settings !== 'object') throw new Error('INVALID_SETTINGS')
    if ('feishuSyncMode' in settings && settings.feishuSyncMode !== undefined && !isFeishuSyncMode(settings.feishuSyncMode)) {
      throw new Error('INVALID_FEISHU_SYNC_MODE')
    }
    return dependencies.saveSettings(settings as SettingsInput)
  })
  ipcMain.handle(IPC_CHANNELS.settingsRestoreRecommended, () => dependencies.restoreRecommendedBehaviorSettings())
  ipcMain.handle(IPC_CHANNELS.importPickLocal, async () => {
    if (!dialog) throw new Error('FILE_DIALOG_UNAVAILABLE')
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm'] }]
    })
    if (result.canceled) return null
    const first = result.filePaths[0]
    return first && isAbsolute(first) ? first : null
  })
  ipcMain.handle(IPC_CHANNELS.importStart, (_event, value: unknown) => invokeImport(() => dependencies.startImport(parseImportRequest(value))))
  ipcMain.handle(IPC_CHANNELS.importRetry, (_event, value: unknown) => invokeImport(() => {
    if (typeof value !== 'string' || !value.trim()) throw codedError('INVALID_IMPORT_RETRY', 'A work id is required.')
    return dependencies.retryImport(value.trim())
  }))
  ipcMain.handle(IPC_CHANNELS.workList, () => dependencies.listWorks())
  ipcMain.handle(IPC_CHANNELS.workGet, (_event, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_WORK_ID')
    return dependencies.getWork(value.trim())
  })
  ipcMain.handle(IPC_CHANNELS.workAnalyze, (_event, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_WORK_ID')
    return dependencies.analyzeWork(value.trim())
  })
  ipcMain.handle(IPC_CHANNELS.workRewrite, async (_event, value: unknown) => {
    if (!dependencies.rewriteWork) throw new Error('REWRITE_UNAVAILABLE')
    if (typeof value !== 'object' || value === null) throw new Error('INVALID_REWRITE_REQUEST')
    const input = value as { workId?: unknown; payload?: unknown }
    const workId = typeof input.workId === 'string' ? input.workId.trim() : ''
    const payload = input.payload
    if (!workId) throw new Error('INVALID_WORK_ID')
    if (!payload || typeof payload !== 'object') throw new Error('INVALID_REWRITE_REQUEST')
    return dependencies.rewriteWork(workId, payload as Parameters<NonNullable<typeof dependencies.rewriteWork>>[1])
  })
  ipcMain.handle(IPC_CHANNELS.workDeleteFailed, async (_event, value: unknown): Promise<DeleteFailedWorkInvokeResult> => {
    try {
      if (typeof value !== 'string' || !value.trim()) throw codedError('INVALID_WORK_DELETE', 'A work id is required.')
      await dependencies.deleteFailedWork(value.trim())
      return { ok: true }
    } catch (error) {
      return { ok: false, error: sanitizeDeleteError(error) }
    }
  })
  ipcMain.handle(IPC_CHANNELS.feishuGet, () => dependencies.getFeishuConnection())
  ipcMain.handle(IPC_CHANNELS.feishuConnectCustomApp, (_event, value: unknown) => (
    invokeFeishu(() => dependencies.connectFeishuCustomApp(parseFeishuCustomAppConnection(value)))
  ))
  ipcMain.handle(IPC_CHANNELS.feishuDisconnect, () => dependencies.disconnectFeishu())
  ipcMain.handle(IPC_CHANNELS.feishuSync, () => invokeFeishu(() => dependencies.syncFeishu()))
  ipcMain.handle(IPC_CHANNELS.feishuRepair, (_event, value: unknown) => (
    dependencies.repairFeishu(parseOptionalFeishuAppToken(value))
  ))
  ipcMain.handle(IPC_CHANNELS.feishuRecreate, () => dependencies.recreateFeishu())
  ipcMain.handle(IPC_CHANNELS.feishuOpenBase, () => dependencies.openFeishuBase())
  ipcMain.handle(IPC_CHANNELS.feishuOpenDeveloperConsole, () => dependencies.openFeishuDeveloperConsole())
  ipcMain.handle(IPC_CHANNELS.modelProfileList, (): ModelProfileView[] => modelProfiles(dependencies).list())
  ipcMain.handle(IPC_CHANNELS.modelProfileCreate, (_event, value: unknown): ModelProfileView => {
    const { input, apiKey } = parseModelProfileDraft(value)
    const profile = modelProfiles(dependencies).create(input, apiKey)
    cloudTestTicket = null
    return profile
  })
  ipcMain.handle(IPC_CHANNELS.modelProfileUpdate, async (_event, id: unknown, value: unknown): Promise<ModelProfileView> => {
    const { input, apiKey } = parseModelProfileDraft(value)
    const profileId = parseModelProfileId(id)
    const profile = modelProfiles(dependencies).update(profileId, input, apiKey)
    if (canReuseCloudTest(cloudTestTicket, profileId, input, apiKey, profile, modelProfiles(dependencies))) {
      cloudTestTicket = null
      try {
        await dependencies.engineHealth?.recordCloudSuccess?.()
      } catch {
        // The profile save has already committed; leave health unknown rather than exposing an internal failure.
      }
    } else {
      cloudTestTicket = null
    }
    return profile
  })
  ipcMain.handle(IPC_CHANNELS.modelProfileTest, async (_event, value: unknown): Promise<ConnectionTestResult> => {
    const { input, apiKey, profileId } = parseModelProfileTest(value)
    cloudTestTicket = null
    const profiles = modelProfiles(dependencies)
    const candidate = profileId && apiKey === undefined
      ? createCloudTestTicket(profiles, profileId, input)
      : null
    const result = await profiles.testConnection(input, apiKey, profileId)
    if (result.ok && candidate && isCloudTestTicketCurrent(candidate, profiles)) {
      cloudTestTicket = candidate
    }
    return result
  })
  ipcMain.handle(IPC_CHANNELS.modelProfileActivate, (_event, id: unknown): ModelProfileView => {
    const profile = modelProfiles(dependencies).setActive(parseModelProfileId(id))
    cloudTestTicket = null
    return profile
  })
  ipcMain.handle(IPC_CHANNELS.modelProfileDelete, (_event, id: unknown): void => {
    modelProfiles(dependencies).delete(parseModelProfileId(id))
    cloudTestTicket = null
  })
  ipcMain.handle(IPC_CHANNELS.modelProfileDeleteKey, (_event, id: unknown): void => {
    modelProfiles(dependencies).deleteApiKey(parseModelProfileId(id))
    cloudTestTicket = null
  })
  ipcMain.handle(IPC_CHANNELS.engineHealthPeek, (): EngineHealthView => engineHealth(dependencies).peekPersisted())
  ipcMain.handle(IPC_CHANNELS.engineHealthGet, (): Promise<EngineHealthView> => engineHealth(dependencies).get())
  ipcMain.handle(IPC_CHANNELS.engineHealthRefresh, (): Promise<EngineHealthView> => engineHealth(dependencies).refreshAll())
  ipcMain.handle(IPC_CHANNELS.agentStatus, (): unknown => agentManager(dependencies).getStatus())
  ipcMain.handle(IPC_CHANNELS.agentDetectCli, (_event, settings: unknown): Promise<AgentCliDetectedView | null> => {
    if (!dependencies.detectAgentCli) {
      return Promise.resolve(null)
    }
    const parsed = (settings && typeof settings === 'object' ? settings : {}) as PublicSettings
    return Promise.resolve(dependencies.detectAgentCli(parsed)).then((result) => {
      // IMPORTANT: DetectedAgentCli carries a function (execArgs) which cannot
      // cross the structured-clone IPC boundary. Return a plain serializable
      // view so the renderer receives the agent instead of a DataCloneError.
      const view: AgentCliDetectedView | null = result
        ? { id: result.id, command: result.command, displayName: result.displayName }
        : null
      return view
    })
  })
  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('INVALID_EXTERNAL_URL')
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('INVALID_EXTERNAL_URL')
    await shell.openExternal(url.toString())
  })
}

function parseTargetedCreatorRetry(value: unknown): TargetedCreatorRetryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TARGETED_RETRY')
  const input = value as { runId?: unknown; creatorIds?: unknown }
  const runId = typeof input.runId === 'string' ? input.runId.trim() : ''
  const safeId = /^[A-Za-z0-9_-]{1,200}$/
  if (!safeId.test(runId) || !Array.isArray(input.creatorIds) || input.creatorIds.length === 0 || input.creatorIds.length > 10) {
    throw new Error('INVALID_TARGETED_RETRY')
  }
  const creatorIds = input.creatorIds.map((creatorId) => typeof creatorId === 'string' ? creatorId.trim() : '')
  if (creatorIds.some((creatorId) => !safeId.test(creatorId)) || new Set(creatorIds).size !== creatorIds.length) {
    throw new Error('INVALID_TARGETED_RETRY')
  }
  return { runId, creatorIds }
}

function modelProfiles(dependencies: IpcDependencies): NonNullable<IpcDependencies['modelProfiles']> {
  if (!dependencies.modelProfiles) throw new Error('MODEL_PROFILE_SERVICE_UNAVAILABLE')
  return dependencies.modelProfiles
}

function agentManager(dependencies: IpcDependencies): AgentManagerLike {
  if (!dependencies.agentManager) throw new Error('AGENT_MANAGER_UNAVAILABLE')
  return dependencies.agentManager
}

function parseModelProfileId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_MODEL_PROFILE_ID')
  return value.trim()
}

function parseModelProfileDraft(value: unknown): { input: ModelProfileInput, apiKey?: string } {
  if (!isPlainObject(value)) throw new Error('INVALID_MODEL_PROFILE')
  const { apiKey, ...input } = value
  if (apiKey !== undefined && typeof apiKey !== 'string') throw new Error('INVALID_MODEL_PROFILE_API_KEY')
  // 配置名称留空时按服务商 + 模型 ID 自动命名
  if (typeof input.name === 'string' && input.name.trim() === '') {
    const provider = AI_PROVIDER_CATALOG.find((entry) => entry.id === input.providerTemplate)
    const providerLabel = provider?.label ?? input.providerTemplate ?? '模型'
    input.name = `${providerLabel} · ${input.modelId ?? '未指定模型'}`.slice(0, 80)
  }
  const parsed = ModelProfileInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('INVALID_MODEL_PROFILE')
  return { input: parsed.data, ...(apiKey === undefined ? {} : { apiKey }) }
}

function parseModelProfileTest(value: unknown): { input: ModelProfileInput, apiKey?: string, profileId?: string } {
  if (!isPlainObject(value)) throw new Error('INVALID_MODEL_PROFILE_TEST')
  const { profileId, ...draft } = value
  if (profileId !== undefined && (typeof profileId !== 'string' || !profileId.trim())) throw new Error('INVALID_MODEL_PROFILE_ID')
  return { ...parseModelProfileDraft(draft), ...(typeof profileId === 'string' ? { profileId: profileId.trim() } : {}) }
}

interface CloudTestTicket {
  profileId: string
  input: ModelProfileInput
  identity: ActiveModelHealthIdentity
  expiresAt: number
}

const CLOUD_TEST_TICKET_TTL_MS = 60_000

function createCloudTestTicket(
  profiles: NonNullable<IpcDependencies['modelProfiles']>,
  profileId: string,
  input: ModelProfileInput
): CloudTestTicket | null {
  const profile = profiles.get?.(profileId)
  const identity = profiles.getActiveHealthIdentity?.()
  if (!profile || !identity || identity.id !== profileId || !profile.active || !profile.enabled || !profile.requiresApiKey || !profile.apiKeyConfigured) return null
  if (!sameProfileInput(profile, input)) return null
  return { profileId, input: { ...input }, identity: { ...identity }, expiresAt: Date.now() + CLOUD_TEST_TICKET_TTL_MS }
}

function isCloudTestTicketCurrent(ticket: CloudTestTicket, profiles: NonNullable<IpcDependencies['modelProfiles']>): boolean {
  const profile = profiles.get?.(ticket.profileId)
  const identity = profiles.getActiveHealthIdentity?.()
  return Boolean(
    profile && identity
    && profile.active && profile.enabled && profile.requiresApiKey && profile.apiKeyConfigured
    && sameProfileInput(profile, ticket.input)
    && sameHealthIdentity(identity, ticket.identity)
  )
}

function canReuseCloudTest(
  ticket: CloudTestTicket | null,
  profileId: string,
  input: ModelProfileInput,
  apiKey: string | undefined,
  saved: ModelProfileView,
  profiles: NonNullable<IpcDependencies['modelProfiles']>
): boolean {
  if (!ticket || Date.now() > ticket.expiresAt || apiKey !== undefined || ticket.profileId !== profileId) return false
  if (!sameProfileInput(ticket.input, input) || !sameProfileInput(saved, input)) return false
  if (!saved.active || !saved.enabled || !saved.requiresApiKey || !saved.apiKeyConfigured || saved.updatedAt !== ticket.identity.updatedAt) return false
  const profile = profiles.get?.(profileId)
  const identity = profiles.getActiveHealthIdentity?.()
  return Boolean(
    profile && identity
    && profile.active && profile.enabled && profile.requiresApiKey && profile.apiKeyConfigured
    && sameHealthIdentity(identity, ticket.identity)
    && sameProfileInput(profile, input)
  )
}

function sameHealthIdentity(current: ActiveModelHealthIdentity, expected: ActiveModelHealthIdentity): boolean {
  return current.id === expected.id
    && current.providerTemplate === expected.providerTemplate
    && current.baseUrl === expected.baseUrl
    && current.modelId === expected.modelId
    && current.updatedAt === expected.updatedAt
    && current.credentialRevision === expected.credentialRevision
}

function sameProfileInput(profile: Pick<ModelProfileView, 'name' | 'providerTemplate' | 'baseUrl' | 'modelId' | 'requiresApiKey' | 'enabled'>, input: ModelProfileInput): boolean {
  return profile.name === input.name
    && profile.providerTemplate === input.providerTemplate
    && profile.baseUrl === input.baseUrl
    && profile.modelId === input.modelId
    && profile.requiresApiKey === input.requiresApiKey
    && profile.enabled === input.enabled
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function parseImportRequest(value: unknown): ImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw codedError('INVALID_IMPORT_REQUEST', 'The import request is invalid.')
  }
  const request = value as Record<string, unknown>
  const creatorId = request.creatorId ?? null
  if (creatorId !== null && typeof creatorId !== 'string') throw codedError('INVALID_IMPORT_REQUEST', 'The import request is invalid.')
  const ownership = request.ownership === undefined ? 'mine' : request.ownership
  if (ownership !== 'mine' && ownership !== 'competitor') throw codedError('INVALID_IMPORT_REQUEST', 'The import request is invalid.')
  const source = request.source
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.getPrototypeOf(source) !== Object.prototype) {
    throw codedError('INVALID_IMPORT_REQUEST', 'The import request is invalid.')
  }
  const sourceValue = source as Record<string, unknown>
  if (sourceValue.type === 'local' && typeof sourceValue.path === 'string' && sourceValue.path.trim()) {
    return { source: { type: 'local', path: sourceValue.path.trim() }, creatorId, ownership }
  }
  if (sourceValue.type === 'douyin_url' && typeof sourceValue.url === 'string') {
    const url = extractDouyinWorkUrl(sourceValue.url)
    if (url) return { source: { type: 'douyin_url', url }, creatorId, ownership }
  }
  throw codedError('INVALID_IMPORT_REQUEST', 'The import request is invalid.')
}

function parseOptionalFeishuAppToken(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_FEISHU_APP_TOKEN')
  return value.trim()
}

function parseFeishuCustomAppConnection(value: unknown): FeishuCustomAppConnectionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_FEISHU_CUSTOM_APP_CONNECTION')
  }
  const input = value as Record<string, unknown>
  const appId = typeof input.appId === 'string' ? input.appId.trim() : ''
  const appSecret = typeof input.appSecret === 'string' ? input.appSecret.trim() : ''
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  if (
    !appId || appId.length > 128
    || !appSecret || appSecret.length > 512
    || !baseUrl || baseUrl.length > 2_048
  ) {
    throw new Error('INVALID_FEISHU_CUSTOM_APP_CONNECTION')
  }
  return { appId, appSecret, baseUrl }
}

function engineHealth(dependencies: IpcDependencies): NonNullable<IpcDependencies['engineHealth']> {
  if (!dependencies.engineHealth) throw new Error('ENGINE_HEALTH_SERVICE_UNAVAILABLE')
  return dependencies.engineHealth
}

async function invokeFeishu<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: toFeishuUserError(error) }
  }
}

async function invokeImport(operation: () => Promise<ImportStartResult>): Promise<ImportInvokeResult> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    const value = error instanceof Error ? error : new Error('Import failed.')
    const metadata = value as Error & { code?: unknown; action?: unknown; retryable?: unknown }
    return {
      ok: false,
      error: {
        code: typeof metadata.code === 'string' ? metadata.code : 'IMPORT_FAILED',
        message: value.message,
        ...(typeof metadata.action === 'string' ? { action: metadata.action } : {}),
        ...(typeof metadata.retryable === 'boolean' ? { retryable: metadata.retryable } : {})
      }
    }
  }
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: false })
}

const SAFE_DELETE_ERRORS = new Map([
  ['INVALID_WORK_DELETE', 'A work id is required.'],
  ['FAILED_WORK_NOT_FOUND', 'The failed work was not found.'],
  ['WORK_DELETE_NOT_ALLOWED', 'Only failed work can be deleted.'],
  ['FAILED_WORK_FILE_CLEANUP_FAILED', 'Failed work files could not be removed.']
])

function sanitizeDeleteError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''
  const message = SAFE_DELETE_ERRORS.get(code)
  return message
    ? { code, message }
    : { code: 'WORK_DELETE_FAILED', message: 'Failed work could not be deleted.' }
}
