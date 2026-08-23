import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { APP_METADATA } from '../shared/app-metadata'
import { feishuUserErrorForCode, IPC_CHANNELS, isFeishuErrorCode, type AgentCliDetectedView, type AgentStatusView, type DashboardData, type DeleteFailedWorkInvokeResult, type EngineHealthView, type FeishuConnectionView, type FeishuCustomAppConnectionInput, type FeishuErrorCode, type FeishuUserError, type ImportInvokeResult, type ImportRequest, type ImportStartResult, type ManualAnalysisResult, type RewriteRequestView, type RewriteResultView, type RunHistoryItem, type RunStartResult, type TargetedCreatorRetryRequest, type UpdateState, type WorkDetail, type WorkFocusRequest, type WorkListItem } from '../shared/ipc-contract'
import type { ConnectionTestResult, CreatorView, ModelProfileConnectionTestRequest, ModelProfileDraft, ModelProfileView, PublicSettings, SettingsInput } from '../shared/ipc-contract'

export interface DesktopApi {
  getDashboard: () => Promise<DashboardData>
  runNow: () => Promise<{ accepted: boolean; reason?: string }>
  listRuns: () => Promise<RunHistoryItem[]>
  retryRun: (id: string) => Promise<{ accepted: boolean; reason?: string }>
  retryFailedCreators: (request: TargetedCreatorRetryRequest) => Promise<RunStartResult>
  deleteRun: (id: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  listCreators: () => Promise<CreatorView[]>
  addCreator: (url: string) => Promise<CreatorView>
  addMyAccount: (url: string) => Promise<CreatorView>
  deleteCreator: (id: string) => Promise<void>
  toggleCreator: (id: string, enabled: boolean) => Promise<void>
  clearUnclassifiedWorks: () => Promise<void>
  loginDouyin: () => Promise<void>
  logoutDouyin: () => Promise<void>
  checkDouyinLogin: () => Promise<{ loggedIn: boolean }>
  getSettings: () => Promise<PublicSettings>
  saveSettings: (settings: SettingsInput) => Promise<PublicSettings>
  restoreRecommendedBehaviorSettings: () => Promise<PublicSettings>
  getUpdateState: () => Promise<UpdateState>
  retryUpdate: () => Promise<void>
  onUpdateState: (listener: (state: UpdateState) => void) => () => void
  pickLocalVideo: () => Promise<string | null>
  getPathForFile: (file: File) => string
  startImport: (request: ImportRequest) => Promise<ImportStartResult>
  retryImport: (workId: string) => Promise<ImportStartResult>
  deleteFailedWork: (workId: string) => Promise<void>
  listWorks: () => Promise<WorkListItem[]>
  getWork: (workId: string) => Promise<WorkDetail | null>
  analyzeWork: (workId: string) => Promise<ManualAnalysisResult>
  rewriteWork: (workId: string, payload: RewriteRequestView) => Promise<RewriteResultView>
  getFeishuConnection: () => Promise<FeishuConnectionView>
  connectFeishuCustomApp: (input: FeishuCustomAppConnectionInput) => Promise<FeishuConnectionView>
  disconnectFeishu: () => Promise<void>
  syncFeishu: () => Promise<FeishuConnectionView>
  repairFeishu: (selectedAppToken?: string) => Promise<FeishuConnectionView>
  recreateFeishu: () => Promise<FeishuConnectionView>
  openFeishuBase: () => Promise<void>
  openFeishuDeveloperConsole: () => Promise<void>
  listModelProfiles: () => Promise<ModelProfileView[]>
  createModelProfile: (profile: ModelProfileDraft) => Promise<ModelProfileView>
  updateModelProfile: (id: string, profile: ModelProfileDraft) => Promise<ModelProfileView>
  testModelProfile: (profile: ModelProfileConnectionTestRequest) => Promise<ConnectionTestResult>
  activateModelProfile: (id: string) => Promise<ModelProfileView>
  deleteModelProfile: (id: string) => Promise<void>
  deleteModelProfileKey: (id: string) => Promise<void>
  peekEngineHealth: () => Promise<EngineHealthView>
  getEngineHealth: () => Promise<EngineHealthView>
  refreshEngineHealth: () => Promise<EngineHealthView>
  getAgentStatus: () => Promise<AgentStatusView>
  detectAgentCli: (settings: PublicSettings) => Promise<AgentCliDetectedView | null>
  onWorkStateChanged: (listener: (workId: string) => void) => () => void
  onWorkFocusRequested: (listener: (request: WorkFocusRequest) => void) => () => void
}

const desktopApi: DesktopApi = {
  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard),
  runNow: () => ipcRenderer.invoke(IPC_CHANNELS.runNow),
  listRuns: () => ipcRenderer.invoke(IPC_CHANNELS.runList),
  retryRun: (id) => ipcRenderer.invoke(IPC_CHANNELS.runRetry, id),
  retryFailedCreators: (request) => ipcRenderer.invoke(IPC_CHANNELS.runRetryCreators, request),
  deleteRun: (id) => ipcRenderer.invoke(IPC_CHANNELS.runDelete, id),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  listCreators: () => ipcRenderer.invoke(IPC_CHANNELS.creatorList),
  addCreator: (url) => ipcRenderer.invoke(IPC_CHANNELS.creatorAdd, url),
  addMyAccount: (url) => ipcRenderer.invoke(IPC_CHANNELS.creatorAddMine, url),
  deleteCreator: (id) => ipcRenderer.invoke(IPC_CHANNELS.creatorDelete, id),
  toggleCreator: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.creatorToggle, id, enabled),
  clearUnclassifiedWorks: () => ipcRenderer.invoke(IPC_CHANNELS.sourceClearUnclassified),
  loginDouyin: () => ipcRenderer.invoke(IPC_CHANNELS.douyinLogin),
  logoutDouyin: () => ipcRenderer.invoke(IPC_CHANNELS.douyinLogout),
  checkDouyinLogin: () => ipcRenderer.invoke(IPC_CHANNELS.douyinCheckLogin),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
  saveSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings),
  restoreRecommendedBehaviorSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsRestoreRecommended),
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.updateGet),
  retryUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateRetry),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
    ipcRenderer.on(IPC_CHANNELS.updateStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateStateChanged, handler)
  },
  pickLocalVideo: () => ipcRenderer.invoke(IPC_CHANNELS.importPickLocal),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  startImport: (request) => invokeImport(IPC_CHANNELS.importStart, request),
  retryImport: (workId) => invokeImport(IPC_CHANNELS.importRetry, workId),
  deleteFailedWork: (workId) => invokeDeleteFailedWork(workId),
  listWorks: () => ipcRenderer.invoke(IPC_CHANNELS.workList),
  getWork: (workId) => ipcRenderer.invoke(IPC_CHANNELS.workGet, workId),
  analyzeWork: (workId) => ipcRenderer.invoke(IPC_CHANNELS.workAnalyze, workId),
  rewriteWork: (workId, payload) => ipcRenderer.invoke(IPC_CHANNELS.workRewrite, { workId, payload }),
  getFeishuConnection: () => ipcRenderer.invoke(IPC_CHANNELS.feishuGet),
  connectFeishuCustomApp: (input) => invokeFeishu(IPC_CHANNELS.feishuConnectCustomApp, input),
  disconnectFeishu: () => ipcRenderer.invoke(IPC_CHANNELS.feishuDisconnect),
  syncFeishu: () => invokeFeishu(IPC_CHANNELS.feishuSync),
  repairFeishu: (selectedAppToken) => ipcRenderer.invoke(IPC_CHANNELS.feishuRepair, selectedAppToken),
  recreateFeishu: () => ipcRenderer.invoke(IPC_CHANNELS.feishuRecreate),
  openFeishuBase: () => ipcRenderer.invoke(IPC_CHANNELS.feishuOpenBase),
  openFeishuDeveloperConsole: () => ipcRenderer.invoke(IPC_CHANNELS.feishuOpenDeveloperConsole),
  listModelProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.modelProfileList),
  createModelProfile: (profile) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileCreate, profile),
  updateModelProfile: (id, profile) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileUpdate, id, profile),
  testModelProfile: (profile) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileTest, profile),
  activateModelProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileActivate, id),
  deleteModelProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileDelete, id),
  deleteModelProfileKey: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelProfileDeleteKey, id),
  peekEngineHealth: () => ipcRenderer.invoke(IPC_CHANNELS.engineHealthPeek),
  getEngineHealth: () => ipcRenderer.invoke(IPC_CHANNELS.engineHealthGet),
  refreshEngineHealth: () => ipcRenderer.invoke(IPC_CHANNELS.engineHealthRefresh),
  getAgentStatus: () => ipcRenderer.invoke(IPC_CHANNELS.agentStatus),
  detectAgentCli: (settings) => ipcRenderer.invoke(IPC_CHANNELS.agentDetectCli, settings),
  onWorkStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, workId: string): void => listener(workId)
    ipcRenderer.on(IPC_CHANNELS.workStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workStateChanged, handler)
  },
  onWorkFocusRequested: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: WorkFocusRequest): void => listener(request)
    ipcRenderer.on(IPC_CHANNELS.workFocusRequested, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workFocusRequested, handler)
  }
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)

async function invokeImport(channel: string, payload: unknown): Promise<ImportStartResult> {
  const result = await ipcRenderer.invoke(channel, payload) as ImportInvokeResult
  if (result.ok) return result.value
  const error = Object.assign(new Error(result.error.message), result.error)
  error.name = 'ImportError'
  throw error
}

async function invokeDeleteFailedWork(workId: string): Promise<void> {
  const result = await ipcRenderer.invoke(IPC_CHANNELS.workDeleteFailed, workId) as DeleteFailedWorkInvokeResult
  if (result.ok) return
  const error = Object.assign(new Error(result.error.message), { code: result.error.code })
  error.name = 'DeleteFailedWorkError'
  throw error
}

async function invokeFeishu<T>(channel: string, payload?: unknown): Promise<T> {
  let result: unknown
  try {
    result = payload === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, payload)
  } catch {
    throw createFeishuError(feishuUserErrorForCode('FEISHU_UNKNOWN_ERROR'))
  }

  if (isFeishuSuccess<T>(result)) return result.value
  if (isFeishuFailure(result)) throw createFeishuError(feishuUserErrorForCode(result.error.code))
  throw createFeishuError(feishuUserErrorForCode('FEISHU_UNKNOWN_ERROR'))
}

function isFeishuSuccess<T>(value: unknown): value is { ok: true; value: T } {
  return isPlainObject(value) && value.ok === true && 'value' in value
}

function isFeishuFailure(value: unknown): value is { ok: false; error: { code: FeishuErrorCode } } {
  return isPlainObject(value)
    && value.ok === false
    && isPlainObject(value.error)
    && isFeishuErrorCode(value.error.code)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createFeishuError(details: FeishuUserError): Error & FeishuUserError {
  const error = new Error(details.code) as Error & FeishuUserError
  error.name = 'FeishuError'
  error.code = details.code
  error.title = details.title
  error.reason = details.reason
  error.action = details.action
  error.retryable = details.retryable
  return error
}
