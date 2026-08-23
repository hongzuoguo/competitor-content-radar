import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const events: string[] = []
  let resolveWindowLoad: (() => void) | null = null
  let rejectWindowLoad: ((error: Error) => void) | null = null
  const runtime = {
    isBusinessIdle: vi.fn(() => true),
    onBusinessIdle: vi.fn(() => vi.fn()),
    onWorkStateChanged: vi.fn(() => vi.fn())
  }

  class BrowserWindow {
    static getAllWindows = vi.fn(() => [])
    webContents = {
      isDestroyed: vi.fn(() => false),
      isLoading: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
    constructor() { events.push('window') }
    focus = vi.fn()
    hide = vi.fn()
    isDestroyed = vi.fn(() => false)
    loadFile = vi.fn(() => new Promise<void>((resolveLoad, rejectLoad) => {
      events.push('window-load-start')
      resolveWindowLoad = resolveLoad
      rejectWindowLoad = rejectLoad
    }))
    loadURL = vi.fn(async () => undefined)
    on = vi.fn()
    once = vi.fn()
    setAppDetails = vi.fn()
    setIcon = vi.fn()
    show = vi.fn()
  }

  class UpdateService {
    subscribe = vi.fn(() => {
      events.push('update-subscribe')
      return vi.fn()
    })
    start = vi.fn(async () => { events.push('update-start') })
  }

  return {
    BrowserWindow, UpdateService, events, runtime,
    resolveWindowLoad: () => resolveWindowLoad?.(),
    rejectWindowLoad: (error: Error) => rejectWindowLoad?.(error),
    reset: () => {
      events.splice(0)
      resolveWindowLoad = null
      rejectWindowLoad = null
    }
  }
})

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => 'E:\\10500\\radar-test\\smoke-startup\\user-data'),
    isPackaged: true,
    on: vi.fn(),
    quit: vi.fn(),
    setAppUserModelId: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve())
  },
  BrowserWindow: mocks.BrowserWindow,
  dialog: { showErrorBox: vi.fn() },
  Menu: { setApplicationMenu: vi.fn() },
  Notification: { isSupported: vi.fn(() => false) },
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn() }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('electron-log/main', () => ({ default: { error: vi.fn(() => mocks.events.push('startup-error')), transports: { file: {} } } }))
vi.mock('../../src/main/ipc', () => ({
  registerIpcHandlers: vi.fn(),
  registerUpdateIpcHandlers: vi.fn(() => mocks.events.push('update-ipc'))
}))
vi.mock('../../src/main/production-runtime', () => ({
  createProductionRuntime: vi.fn(() => {
    mocks.events.push('core')
    return {
      agentManager: {},
      detectAgentCli: vi.fn(),
      engineHealth: {},
      modelProfiles: {},
      runtime: mocks.runtime
    }
  })
}))
vi.mock('../../src/main/update-service', () => ({ UpdateService: mocks.UpdateService }))
vi.mock('../../src/main/tray', () => ({ createAppTray: vi.fn(() => ({ destroy: vi.fn() })) }))
vi.mock('../../src/main/import-notifications', () => ({
  ImportNotificationController: class { close = vi.fn() }
}))
vi.mock('../../src/main/user-data-override', () => ({ resolveUserDataOverride: vi.fn(() => undefined) }))
vi.mock('../../src/main/smoke-network-policy', () => ({
  installSmokeNetworkPolicy: vi.fn(() => mocks.events.push('smoke-network-policy'))
}))
vi.mock('../../src/main/smoke-runtime-readiness', () => ({
  prepareSmokeRuntimeReadiness: vi.fn(async () => {
    mocks.events.push('smoke-runtime-readiness-prepare')
    return async () => { mocks.events.push('smoke-runtime-readiness-publish') }
  })
}))

describe('application startup wiring', () => {
  it('publishes smoke readiness only after the initial window load and update startup settle', async () => {
    const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: 'C:\\resources' })
    try {
      await import('../../src/main/index')

      await vi.waitFor(() => {
        expect(mocks.events).toEqual(['smoke-network-policy', 'smoke-runtime-readiness-prepare', 'update-ipc', 'core', 'window', 'window-load-start', 'update-subscribe', 'update-start'])
      })
      mocks.resolveWindowLoad()
      await vi.waitFor(() => {
        expect(mocks.events).toEqual(['smoke-network-policy', 'smoke-runtime-readiness-prepare', 'update-ipc', 'core', 'window', 'window-load-start', 'update-subscribe', 'update-start', 'smoke-runtime-readiness-publish'])
      })
    } finally {
      if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
      else Reflect.deleteProperty(process, 'resourcesPath')
    }
  })

  it('does not publish smoke readiness when the initial window load rejects', async () => {
    mocks.reset()
    vi.resetModules()
    const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: 'C:\\resources' })
    try {
      await import('../../src/main/index')

      await vi.waitFor(() => {
        expect(mocks.events).toEqual(['smoke-network-policy', 'smoke-runtime-readiness-prepare', 'update-ipc', 'core', 'window', 'window-load-start', 'update-subscribe', 'update-start'])
      })
      mocks.rejectWindowLoad(new Error('window failed'))
      await vi.waitFor(() => {
        expect(mocks.events).toEqual(['smoke-network-policy', 'smoke-runtime-readiness-prepare', 'update-ipc', 'core', 'window', 'window-load-start', 'update-subscribe', 'update-start', 'startup-error'])
      })
    } finally {
      if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
      else Reflect.deleteProperty(process, 'resourcesPath')
    }
  })
})
