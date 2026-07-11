import { ipcMain, shell } from 'electron'
import { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type DashboardData } from '../shared/ipc-contract'

export interface IpcDependencies {
  getDashboard(): Promise<DashboardData>
  runNow(): Promise<{ accepted: boolean; reason?: string }>
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.appMetadata, () => APP_METADATA)
  ipcMain.handle(IPC_CHANNELS.dashboard, () => dependencies.getDashboard())
  ipcMain.handle(IPC_CHANNELS.runNow, () => dependencies.runNow())
  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('INVALID_EXTERNAL_URL')
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('INVALID_EXTERNAL_URL')
    await shell.openExternal(url.toString())
  })
}
