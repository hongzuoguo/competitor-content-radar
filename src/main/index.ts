import { app, BrowserWindow, dialog, Menu, Notification, session, shell, type Tray } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import { join } from 'node:path'
import { APP_METADATA } from '../shared/app-metadata'
import { IPC_CHANNELS, type WorkFocusRequest } from '../shared/ipc-contract'
import { registerIpcHandlers, registerUpdateIpcHandlers } from './ipc'
import { createAppTray } from './tray'
import { createProductionRuntime, type ProductionRuntime, verifyPackagedRuntimeReadiness } from './production-runtime'
import { UpdateService, type UpdaterAdapter } from './update-service'
import { ImportNotificationController } from './import-notifications'
import { resolveUserDataOverride } from './user-data-override'
import { installSmokeNetworkPolicy } from './smoke-network-policy'
import { prepareSmokeRuntimeReadiness } from './smoke-runtime-readiness'

const userDataOverride = resolveUserDataOverride(process.argv)
if (userDataOverride) app.setPath('userData', userDataOverride)
if (process.platform === 'win32') app.setAppUserModelId(APP_METADATA.windowsAppUserModelId)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let shutdownComplete = false
let quitPromise: Promise<void> | null = null
let production: ProductionRuntime | null = null
let updateService: UpdateService | null = null
let coreReady = false
let importNotifications: ImportNotificationController | null = null
let unsubscribeWorkState: (() => void) | null = null
let unsubscribeBusinessIdle: (() => void) | null = null
let unsubscribeUpdateState: (() => void) | null = null
const windowLoadPromises = new WeakMap<BrowserWindow, Promise<void>>()

function prepareToQuit(): Promise<void> {
  quitPromise ??= (async () => {
    isQuitting = true
    tray?.destroy()
    unsubscribeWorkState?.()
    unsubscribeWorkState = null
    unsubscribeBusinessIdle?.()
    unsubscribeBusinessIdle = null
    unsubscribeUpdateState?.()
    unsubscribeUpdateState = null
    try {
      await production?.close()
    } finally {
      importNotifications?.close()
    }
  })()
  return quitPromise
}

async function requestAppQuit(): Promise<void> {
  try {
    await prepareToQuit()
    shutdownComplete = true
    app.quit()
  } catch {
    log.error('应用退出准备失败', { errorCode: 'SHUTDOWN_FAILED' })
  }
}

function applyWindowsTaskbarIdentity(window: BrowserWindow, icon: string): void {
  if (process.platform !== 'win32') return
  window.setIcon(icon)
  if (!app.isPackaged) return
  window.setAppDetails({
    appId: APP_METADATA.windowsAppUserModelId,
    appIconPath: process.execPath,
    appIconIndex: 0,
    relaunchCommand: process.execPath,
    relaunchDisplayName: APP_METADATA.productName
  })
}

function createMainWindow(): BrowserWindow {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'hitmuse-mark.png')
    : join(__dirname, '../renderer/hitmuse-mark.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    icon,
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

  applyWindowsTaskbarIdentity(window, icon)

  window.once('ready-to-show', () => window.show())
  window.on('show', () => applyWindowsTaskbarIdentity(window, icon))
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    if (!coreReady) {
      void requestAppQuit()
      return
    }
    window.hide()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    windowLoadPromises.set(window, window.loadURL(process.env.ELECTRON_RENDERER_URL))
  } else {
    windowLoadPromises.set(window, window.loadFile(join(__dirname, '../renderer/index.html')))
  }

  return window
}

function focusImportedWork(request: WorkFocusRequest): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
  mainWindow.show()
  mainWindow.focus()
  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.workFocusRequested, request)
    }
  }
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send)
  else send()
}

async function initializeApplication(): Promise<void> {
  if (app.isPackaged) {
    log.transports.file.level = 'info'
    autoUpdater.logger = log
    updateService = new UpdateService(
      autoUpdater as unknown as UpdaterAdapter,
      () => production?.runtime.isBusinessIdle() ?? true,
      async () => {
        await prepareToQuit()
        shutdownComplete = true
      },
      () => app.exit(1)
    )
  }
  registerUpdateIpcHandlers(updateService ?? undefined)

  coreReady = true
  initializeCoreBusiness()
  mainWindow = createMainWindow()
  const mainWindowLoad = windowLoadPromises.get(mainWindow)
  if (!mainWindowLoad) throw new Error('HITMUSE_MAIN_WINDOW_LOAD_UNAVAILABLE')
  unsubscribeUpdateState = updateService?.subscribe((state) => mainWindow?.webContents.send(IPC_CHANNELS.updateStateChanged, state)) ?? null
  void updateService?.start()
  await mainWindowLoad
}

function initializeCoreBusiness(): void {
  importNotifications = new ImportNotificationController(
    Notification.isSupported() ? (options) => new Notification(options) : null,
    focusImportedWork
  )
  production = createProductionRuntime({ notification: importNotifications })
  const runtime = production.runtime
  if (updateService) {
    unsubscribeBusinessIdle = runtime.onBusinessIdle(() => updateService?.notifyBusinessIdle())
  }
  registerIpcHandlers({
    getDashboard: () => runtime.getDashboard(),
    runNow: () => runtime.runNow(),
    listRuns: () => runtime.listRuns(),
    retryRun: (id) => runtime.retryRun(id),
    retryFailedCreators: (request) => runtime.retryFailedCreators(request),
    deleteRun: (id) => runtime.deleteRun(id),
    listCreators: () => runtime.listCreators(),
    addCreator: (input) => runtime.addCreator(input),
    deleteCreator: (id) => runtime.deleteCreator(id),
    toggleCreator: (id, enabled) => runtime.toggleCreator(id, enabled),
    clearUnclassifiedWorks: () => runtime.clearUnclassifiedWorks(),
    loginDouyin: () => runtime.loginDouyin(),
    logoutDouyin: () => runtime.logoutDouyin(),
    checkDouyinLogin: () => runtime.checkDouyinLogin(),
    getSettings: () => runtime.getSettings(),
    saveSettings: (settings) => runtime.saveSettings(settings),
    restoreRecommendedBehaviorSettings: () => runtime.restoreRecommendedBehaviorSettings(),
    startImport: (request) => runtime.startImport(request),
    retryImport: (workId) => runtime.retryImport(workId),
    deleteFailedWork: (workId) => runtime.deleteFailedWork(workId),
    listWorks: () => runtime.listWorks(),
    getWork: (id) => runtime.getWork(id),
    analyzeWork: (id) => runtime.analyzeWork(id),
    getFeishuConnection: () => runtime.getFeishuConnection(),
    connectFeishuCustomApp: (input) => runtime.connectFeishuCustomApp(input),
    disconnectFeishu: () => runtime.disconnectFeishu(),
    syncFeishu: () => runtime.syncFeishu(),
    repairFeishu: (selectedAppToken) => runtime.repairFeishu(selectedAppToken),
    recreateFeishu: () => runtime.recreateFeishu(),
    openFeishuBase: () => runtime.openFeishuBase(),
    openFeishuDeveloperConsole: () => runtime.openFeishuDeveloperConsole(),
    modelProfiles: production.modelProfiles,
    engineHealth: production.engineHealth,
    agentManager: production.agentManager,
    detectAgentCli: production.detectAgentCli,
    rewriteWork: (workId, payload) => runtime.rewriteWork(workId, payload)
  }, undefined, dialog)
  unsubscribeWorkState = runtime.onWorkStateChanged((workId) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.workStateChanged, workId)
    }
  })
  tray = createAppTray({
    showWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
      mainWindow.show()
      mainWindow.focus()
    },
    runNow: () => { void runtime.runNow() },
    quit: () => {
      void requestAppQuit()
    }
  })
}

app.whenReady().then(async () => {
  app.setName(APP_METADATA.productName)
  Menu.setApplicationMenu(null)
  const smokeNetworkPolicyInstalled = installSmokeNetworkPolicy(process.argv, session.defaultSession, log)
  const publishSmokeRuntimeReadiness = await prepareSmokeRuntimeReadiness(process.argv, app.getPath('userData'), {
    verify: async () => {
      if (!smokeNetworkPolicyInstalled) throw new Error('HITMUSE_SMOKE_RUNTIME_READINESS_NETWORK_POLICY_REQUIRED')
      await verifyPackagedRuntimeReadiness(app.getPath('userData'))
    }
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
  await initializeApplication()
  await publishSmokeRuntimeReadiness?.()
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('Application startup failed', { error: message })
  dialog.showErrorBox(
    'HitMuse 无法启动',
    `启动过程中发生错误：${message}\n\n请将此提示截图发给开发者。`
  )
  app.exit(1)
})

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void requestAppQuit()
})
