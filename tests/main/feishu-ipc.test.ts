import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  shell: { openExternal: vi.fn() }
}))

import { registerIpcHandlers, type IpcDependencies } from '../../src/main/ipc'
import { IPC_CHANNELS, type FeishuConnectionView, type IpcResult } from '../../src/shared/ipc-contract'

function connection(): FeishuConnectionView {
  return {
    status: 'connected',
    baseName: '对标内容雷达',
    baseUrl: 'https://example.feishu.cn/base/app-token',
    lastSyncedAt: '2026-07-25T08:00:00.000Z',
    message: '已连接',
    customAppConfigured: true,
    maskedAppId: 'cli_***mple'
  }
}

function dependencies(): IpcDependencies {
  return {
    getDashboard: vi.fn(), runNow: vi.fn(), listRuns: vi.fn(), retryRun: vi.fn(), deleteRun: vi.fn(),
    listCreators: vi.fn(), addCreator: vi.fn(), deleteCreator: vi.fn(), toggleCreator: vi.fn(),
    clearUnclassifiedWorks: vi.fn(), loginDouyin: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(),
    startImport: vi.fn(), retryImport: vi.fn(), deleteFailedWork: vi.fn(), listWorks: vi.fn(),
    getWork: vi.fn(), analyzeWork: vi.fn(), getFeishuConnection: vi.fn(), connectFeishuCustomApp: vi.fn(),
    disconnectFeishu: vi.fn(), syncFeishu: vi.fn(), repairFeishu: vi.fn(),
    recreateFeishu: vi.fn(), openFeishuBase: vi.fn(), openFeishuDeveloperConsole: vi.fn()
  }
}

describe('Feishu IPC', () => {
  beforeEach(() => handlers.clear())

  it('returns serialized success envelopes for connect and sync while leaving other Feishu routes unchanged', async () => {
    const deps = dependencies()
    const view = connection()
    vi.mocked(deps.getFeishuConnection).mockResolvedValue(view)
    vi.mocked(deps.disconnectFeishu).mockResolvedValue()
    vi.mocked(deps.syncFeishu).mockResolvedValue(view)
    vi.mocked(deps.recreateFeishu).mockResolvedValue(view)
    vi.mocked(deps.openFeishuBase).mockResolvedValue()
    vi.mocked(deps.openFeishuDeveloperConsole).mockResolvedValue()
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.feishuGet)?.({})).resolves.toBe(view)
    await expect(handlers.get(IPC_CHANNELS.feishuDisconnect)?.({})).resolves.toBeUndefined()
    await expect(handlers.get(IPC_CHANNELS.feishuSync)?.({})).resolves.toEqual({ ok: true, value: view })
    await expect(handlers.get(IPC_CHANNELS.feishuRecreate)?.({})).resolves.toBe(view)
    await expect(handlers.get(IPC_CHANNELS.feishuOpenBase)?.({})).resolves.toBeUndefined()
    await expect(handlers.get(IPC_CHANNELS.feishuOpenDeveloperConsole)?.({})).resolves.toBeUndefined()

    expect(deps.getFeishuConnection).toHaveBeenCalledOnce()
    expect(deps.disconnectFeishu).toHaveBeenCalledOnce()
    expect(deps.syncFeishu).toHaveBeenCalledOnce()
    expect(deps.recreateFeishu).toHaveBeenCalledOnce()
    expect(deps.openFeishuBase).toHaveBeenCalledOnce()
    expect(deps.openFeishuDeveloperConsole).toHaveBeenCalledOnce()
  })

  it('accepts and trims a custom-app connection input', async () => {
    const deps = dependencies()
    vi.mocked(deps.connectFeishuCustomApp).mockResolvedValue(connection())
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.feishuConnectCustomApp)?.({}, {
      appId: ' cli_example ',
      appSecret: ' app-secret ',
      baseUrl: ' https://example.feishu.cn/base/base-1 '
    })).resolves.toEqual({ ok: true, value: connection() })

    expect(deps.connectFeishuCustomApp).toHaveBeenCalledWith({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })
  })

  it('serializes invalid custom-app inputs without leaking their secret', async () => {
    const invalidValues = [
      null,
      '',
      {},
      { appId: '', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1' },
      { appId: 'cli_example', appSecret: '   ', baseUrl: 'https://example.feishu.cn/base/base-1' },
      { appId: 'cli_example', appSecret: 'secret', baseUrl: 123 }
    ]

    for (const value of invalidValues) {
      const deps = dependencies()
      registerIpcHandlers(deps)
      const result = await handlers.get(IPC_CHANNELS.feishuConnectCustomApp)?.({}, value) as IpcResult<FeishuConnectionView>
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'FEISHU_UNKNOWN_ERROR'
        }
      })
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(deps.connectFeishuCustomApp).not.toHaveBeenCalled()
    }
  })

  it('serializes connect and sync failures without raw Electron or credential details', async () => {
    const deps = dependencies()
    const raw = 'Error invoking remote method feishu:sync: Bearer bearer-token appSecret=app-secret raw-body {"detail":"no"}\nstack: private'
    vi.mocked(deps.connectFeishuCustomApp).mockRejectedValueOnce(new Error(raw))
    vi.mocked(deps.syncFeishu).mockRejectedValueOnce(new Error(raw))
    registerIpcHandlers(deps)

    const connectResult = await handlers.get(IPC_CHANNELS.feishuConnectCustomApp)?.({}, {
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    }) as IpcResult<FeishuConnectionView>
    const syncResult = await handlers.get(IPC_CHANNELS.feishuSync)?.({}) as IpcResult<FeishuConnectionView>

    for (const result of [connectResult, syncResult]) {
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'FEISHU_SECRET_INVALID'
        }
      })
      const serialized = JSON.stringify(result)
      for (const forbidden of ['app-secret', 'appSecret', 'Bearer', 'raw-body', 'stack:', 'Error invoking remote method']) {
        expect(serialized).not.toContain(forbidden)
      }
    }
  })

  it('preserves the document-app permission classification across IPC', async () => {
    const deps = dependencies()
    vi.mocked(deps.connectFeishuCustomApp).mockRejectedValueOnce(new Error('FEISHU_API_91403'))
    registerIpcHandlers(deps)

    const result = await handlers.get(IPC_CHANNELS.feishuConnectCustomApp)?.({}, {
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/wiki/wiki-1'
    }) as IpcResult<FeishuConnectionView>

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'FEISHU_PERMISSION_DENIED',
        reason: '应用权限未发布，或目标 Base 未授权该应用管理',
        action: expect.stringContaining('添加该应用为文档应用')
      }
    })
  })

  it('accepts an omitted or trimmed app token for repair', async () => {
    const deps = dependencies()
    const operation = deps.repairFeishu
    vi.mocked(operation).mockResolvedValue(connection())
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.feishuRepair)?.({}, undefined)
    await handlers.get(IPC_CHANNELS.feishuRepair)?.({}, ' app-token ')

    expect(operation).toHaveBeenNthCalledWith(1, undefined)
    expect(operation).toHaveBeenNthCalledWith(2, 'app-token')
  })

  it('rejects invalid repair app tokens before calling the dependency', () => {
    const invalidValues = [null, '', '   ', 123, {}, []]

    for (const value of invalidValues) {
      const deps = dependencies()
      registerIpcHandlers(deps)
      expect(() => handlers.get(IPC_CHANNELS.feishuRepair)?.({}, value)).toThrow('INVALID_FEISHU_APP_TOKEN')
      expect(deps.repairFeishu).not.toHaveBeenCalled()
    }
  })

  it('rejects unsupported Feishu sync modes before saving settings', () => {
    const deps = dependencies()
    registerIpcHandlers(deps)

    expect(() => handlers.get(IPC_CHANNELS.settingsSave)?.({}, { feishuSyncMode: 'scheduled' }))
      .toThrow('INVALID_FEISHU_SYNC_MODE')
    expect(deps.saveSettings).not.toHaveBeenCalled()
  })
})
