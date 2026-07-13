import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type DashboardData, type ImportInvokeResult, type ImportRequest, type ImportStartResult, type UpdateState, type WorkListItem } from '../shared/ipc-contract'
import type { CreatorView, PublicSettings } from '../shared/ipc-contract'

export interface DesktopApi {
  getAppMetadata: () => Promise<typeof APP_METADATA>
  getDashboard: () => Promise<DashboardData>
  runNow: () => Promise<{ accepted: boolean; reason?: string }>
  openExternal: (url: string) => Promise<void>
  listCreators: () => Promise<CreatorView[]>
  addCreator: (url: string) => Promise<CreatorView>
  deleteCreator: (id: string) => Promise<void>
  toggleCreator: (id: string, enabled: boolean) => Promise<void>
  loginDouyin: () => Promise<void>
  getSettings: () => Promise<PublicSettings>
  saveSettings: (settings: Partial<PublicSettings> & { apiKey?: string }) => Promise<PublicSettings>
  getUpdateState: () => Promise<UpdateState>
  retryUpdate: () => Promise<void>
  onUpdateState: (listener: (state: UpdateState) => void) => () => void
  pickLocalVideo: () => Promise<string | null>
  getPathForFile: (file: File) => string
  startImport: (request: ImportRequest) => Promise<ImportStartResult>
  retryImport: (workId: string) => Promise<ImportStartResult>
  listWorks: () => Promise<WorkListItem[]>
  onWorkStateChanged: (listener: (workId: string) => void) => () => void
}

const desktopApi: DesktopApi = {
  getAppMetadata: () => ipcRenderer.invoke(IPC_CHANNELS.appMetadata),
  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard),
  runNow: () => ipcRenderer.invoke(IPC_CHANNELS.runNow),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  listCreators: () => ipcRenderer.invoke(IPC_CHANNELS.creatorList),
  addCreator: (url) => ipcRenderer.invoke(IPC_CHANNELS.creatorAdd, url),
  deleteCreator: (id) => ipcRenderer.invoke(IPC_CHANNELS.creatorDelete, id),
  toggleCreator: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.creatorToggle, id, enabled),
  loginDouyin: () => ipcRenderer.invoke(IPC_CHANNELS.douyinLogin),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
  saveSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings),
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
  listWorks: () => ipcRenderer.invoke(IPC_CHANNELS.workList),
  onWorkStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, workId: string): void => listener(workId)
    ipcRenderer.on(IPC_CHANNELS.workStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workStateChanged, handler)
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
