import { contextBridge } from 'electron'
import { APP_METADATA } from '../shared/app-metadata'

export interface DesktopApi {
  getAppMetadata: () => typeof APP_METADATA
}

const desktopApi: DesktopApi = {
  getAppMetadata: () => APP_METADATA
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
