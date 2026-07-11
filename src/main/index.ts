import { app, BrowserWindow, shell, type Tray } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { AppScheduler } from './scheduler'
import { registerIpcHandlers } from './ipc'
import { createAppTray } from './tray'
import { createProductionRuntime, type ProductionRuntime } from './production-runtime'
import { UpdateService, type UpdaterAdapter } from './update-service'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let production: ProductionRuntime | null = null
let scheduler: AppScheduler | null = null
let updateService: UpdateService | null = null

function prepareToQuit(): void {
  isQuitting = true
  scheduler?.stop()
  tray?.destroy()
  production?.close()
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: APP_METADATA.productName,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  app.setName(APP_METADATA.productName)
  app.setAppUserModelId('com.contentradar.desktop')
  production = createProductionRuntime()
  const runtime = production.runtime
  if (app.isPackaged) {
    updateService = new UpdateService(
      autoUpdater as unknown as UpdaterAdapter,
      () => runtime.isBusinessIdle(),
      prepareToQuit
    )
    runtime.onBusinessIdle(() => updateService?.notifyBusinessIdle())
  }
  registerIpcHandlers(runtime, updateService ?? undefined)
  mainWindow = createMainWindow()
  updateService?.subscribe((state) => mainWindow?.webContents.send(IPC_CHANNELS.updateStateChanged, state))
  void updateService?.start()
  tray = createAppTray({
    showWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
      mainWindow.show()
      mainWindow.focus()
    },
    runNow: () => { void runtime.runNow() },
    quit: () => {
      prepareToQuit()
      app.quit()
    }
  })
  scheduler = new AppScheduler(
    async () => { await runtime.runNow() },
    async () => { await runtime.runNow() }
  )
  scheduler.start(null)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

app.on('before-quit', () => {
  prepareToQuit()
})
