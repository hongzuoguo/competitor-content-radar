import { contextBridge, ipcRenderer } from 'electron'
import type { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type DashboardData } from '../shared/ipc-contract'

export interface DesktopApi {
  getAppMetadata: () => Promise<typeof APP_METADATA>
  getDashboard: () => Promise<DashboardData>
  runNow: () => Promise<{ accepted: boolean; reason?: string }>
  openExternal: (url: string) => Promise<void>
}

const desktopApi: DesktopApi = {
  getAppMetadata: () => ipcRenderer.invoke(IPC_CHANNELS.appMetadata),
  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard),
  runNow: () => ipcRenderer.invoke(IPC_CHANNELS.runNow),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url)
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
