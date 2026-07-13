import { ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type CreatorView, type DashboardData, type ImportRequest, type ImportStartResult, type PublicSettings, type UpdateState, type WorkListItem } from '../shared/ipc-contract'

export interface IpcDependencies {
  getDashboard(): Promise<DashboardData>
  runNow(): Promise<{ accepted: boolean; reason?: string }>
  listCreators(): Promise<CreatorView[]>
  addCreator(url: string): Promise<CreatorView>
  deleteCreator(id: string): Promise<void>
  toggleCreator(id: string, enabled: boolean): Promise<void>
  loginDouyin(): Promise<void>
  getSettings(): Promise<PublicSettings>
  saveSettings(settings: Partial<PublicSettings> & { apiKey?: string }): Promise<PublicSettings>
  startImport(request: ImportRequest): Promise<ImportStartResult>
  retryImport(workId: string): Promise<ImportStartResult>
  listWorks(): Promise<WorkListItem[]>
}

export interface UpdateIpcDependencies {
  getState(): UpdateState
  retry(): Promise<void>
}

export interface FileDialog {
  showOpenDialog(options: {
    properties: ['openFile']
    filters: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

export function registerIpcHandlers(dependencies: IpcDependencies, updates?: UpdateIpcDependencies, dialog?: FileDialog): void {
  ipcMain.handle(IPC_CHANNELS.appMetadata, () => APP_METADATA)
  ipcMain.handle(IPC_CHANNELS.dashboard, () => dependencies.getDashboard())
  ipcMain.handle(IPC_CHANNELS.runNow, () => dependencies.runNow())
  ipcMain.handle(IPC_CHANNELS.creatorList, () => dependencies.listCreators())
  ipcMain.handle(IPC_CHANNELS.creatorAdd, (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('INVALID_CREATOR_URL')
    return dependencies.addCreator(url)
  })
  ipcMain.handle(IPC_CHANNELS.creatorDelete, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('INVALID_CREATOR_DELETE')
    return dependencies.deleteCreator(id)
  })
  ipcMain.handle(IPC_CHANNELS.creatorToggle, (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('INVALID_CREATOR_TOGGLE')
    return dependencies.toggleCreator(id, enabled)
  })
  ipcMain.handle(IPC_CHANNELS.douyinLogin, () => dependencies.loginDouyin())
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => dependencies.getSettings())
  ipcMain.handle(IPC_CHANNELS.settingsSave, (_event, settings: unknown) => {
    if (!settings || typeof settings !== 'object') throw new Error('INVALID_SETTINGS')
    return dependencies.saveSettings(settings as Partial<PublicSettings> & { apiKey?: string })
  })
  ipcMain.handle(IPC_CHANNELS.updateGet, () => updates?.getState() ?? { status: 'idle' })
  ipcMain.handle(IPC_CHANNELS.updateRetry, () => updates?.retry())
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
  ipcMain.handle(IPC_CHANNELS.importStart, (_event, value: unknown) => dependencies.startImport(parseImportRequest(value)))
  ipcMain.handle(IPC_CHANNELS.importRetry, (_event, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_IMPORT_RETRY')
    return dependencies.retryImport(value.trim())
  })
  ipcMain.handle(IPC_CHANNELS.workList, () => dependencies.listWorks())
  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('INVALID_EXTERNAL_URL')
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('INVALID_EXTERNAL_URL')
    await shell.openExternal(url.toString())
  })
}

function parseImportRequest(value: unknown): ImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('INVALID_IMPORT_REQUEST')
  }
  const request = value as Record<string, unknown>
  const creatorId = request.creatorId ?? null
  if (creatorId !== null && typeof creatorId !== 'string') throw new Error('INVALID_IMPORT_REQUEST')
  const source = request.source
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.getPrototypeOf(source) !== Object.prototype) {
    throw new Error('INVALID_IMPORT_REQUEST')
  }
  const sourceValue = source as Record<string, unknown>
  if (sourceValue.type === 'local' && typeof sourceValue.path === 'string' && sourceValue.path.trim()) {
    return { source: { type: 'local', path: sourceValue.path.trim() }, creatorId }
  }
  if (sourceValue.type === 'douyin_url' && typeof sourceValue.url === 'string' && sourceValue.url.trim()) {
    return { source: { type: 'douyin_url', url: sourceValue.url.trim() }, creatorId }
  }
  throw new Error('INVALID_IMPORT_REQUEST')
}
