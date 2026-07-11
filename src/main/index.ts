import { app, BrowserWindow, shell, type Tray } from 'electron'
import { join } from 'node:path'
import { APP_METADATA } from '../shared/app-metadata'
import { nextDailyRun, AppScheduler } from './scheduler'
import { registerIpcHandlers, type IpcDependencies } from './ipc'
import { createAppTray } from './tray'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const runtime: IpcDependencies = {
  async getDashboard() {
    return {
      lastRunAt: null,
      nextRunAt: nextDailyRun(new Date()).toISOString(),
      creators: 0,
      newWorks: 0,
      analyzedWorks: 0,
      highlights: []
    }
  },
  async runNow() {
    return { accepted: false, reason: '请先完成抖音登录和 AI 模型设置' }
  }
}

const scheduler = new AppScheduler(
  async () => { await runtime.runNow() },
  async () => { await runtime.runNow() }
)

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
  registerIpcHandlers(runtime)
  mainWindow = createMainWindow()
  tray = createAppTray({
    showWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
      mainWindow.show()
      mainWindow.focus()
    },
    runNow: () => { void runtime.runNow() },
    quit: () => {
      isQuitting = true
      app.quit()
    }
  })
  scheduler.start(null)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  scheduler.stop()
  tray?.destroy()
})
