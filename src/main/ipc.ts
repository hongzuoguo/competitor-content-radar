import { ipcMain, shell } from 'electron'
import { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type CreatorView, type DashboardData, type PublicSettings, type UpdateState } from '../shared/ipc-contract'

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
}

export interface UpdateIpcDependencies {
  getState(): UpdateState
  retry(): Promise<void>
}

export function registerIpcHandlers(dependencies: IpcDependencies, updates?: UpdateIpcDependencies): void {
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
  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('INVALID_EXTERNAL_URL')
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('INVALID_EXTERNAL_URL')
    await shell.openExternal(url.toString())
  })
}
