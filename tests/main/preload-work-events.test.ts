import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn(), exposedApi: undefined as
  { onWorkStateChanged(listener: (workId: string) => void): () => void
    onWorkFocusRequested(listener: (request: { workId: string; requestId: string }) => void): () => void
    getWork(workId: string): Promise<unknown>
    startImport(request: unknown): Promise<unknown>
    deleteFailedWork(workId: string): Promise<void>
    getFeishuConnection(): Promise<unknown>
    connectFeishuCustomApp(input: { appId: string; appSecret: string; baseUrl: string }): Promise<unknown>
    disconnectFeishu(): Promise<void>
    syncFeishu(): Promise<unknown>
    repairFeishu(selectedAppToken?: string): Promise<unknown>
    recreateFeishu(): Promise<unknown>
    openFeishuBase(): Promise<void>
    openFeishuDeveloperConsole(): Promise<void>
    peekEngineHealth(): Promise<unknown>
    getEngineHealth(): Promise<unknown>
    refreshEngineHealth(): Promise<unknown>
    retryFailedCreators(input: { runId: string; creatorIds: string[] }): Promise<unknown>
    restoreRecommendedBehaviorSettings(): Promise<unknown>
    getPathForFile(file: File): string } | undefined,
  getPathForFile: vi.fn() }))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn((_name: string, api: NonNullable<typeof mocks.exposedApi>) => { mocks.exposedApi = api }) },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener },
  webUtils: { getPathForFile: mocks.getPathForFile }
}))

import '../../src/preload/index'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

describe('preload work events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockReset()
  })

  it('resolves a dropped File through Electron webUtils', () => {
    const file = new File(['video'], 'clip.mp4')
    mocks.getPathForFile.mockReturnValueOnce('C:\\clips\\clip.mp4')
    expect(mocks.exposedApi!.getPathForFile(file)).toBe('C:\\clips\\clip.mp4')
    expect(mocks.getPathForFile).toHaveBeenCalledWith(file)
  })

  it('does not expose an Agent MCP configuration API', () => {
    expect(mocks.exposedApi).not.toHaveProperty('getAgentMcpConfig')
  })

  it('removes the exact handler registered for work state changes', () => {
    const listener = vi.fn()
    const unsubscribe = mocks.exposedApi!.onWorkStateChanged(listener)
    const handler = mocks.on.mock.calls.find(([channel]) => channel === IPC_CHANNELS.workStateChanged)?.[1]
    expect(handler).toBeTypeOf('function')

    unsubscribe()

    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.workStateChanged, handler)
  })

  it('invokes the exact work-detail channel', async () => {
    mocks.invoke.mockResolvedValueOnce({ id: 'work-1' })

    await expect(mocks.exposedApi!.getWork('work-1')).resolves.toEqual({ id: 'work-1' })

    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workGet, 'work-1')
  })

  it('removes the exact handler registered for notification work focus', () => {
    const listener = vi.fn()
    const unsubscribe = mocks.exposedApi!.onWorkFocusRequested(listener)
    const handler = mocks.on.mock.calls.find(([channel]) => channel === IPC_CHANNELS.workFocusRequested)?.[1]
    expect(handler).toBeTypeOf('function')
    handler({}, { workId: 'work-1', requestId: 'request-1' })
    expect(listener).toHaveBeenCalledWith({ workId: 'work-1', requestId: 'request-1' })

    unsubscribe()

    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.workFocusRequested, handler)
  })

  it('reconstructs stable import error metadata from the serialized envelope', async () => {
    mocks.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_CREATOR', message: 'Creator missing', action: 'Choose another creator', retryable: false }
    })

    const error = await mocks.exposedApi!.startImport({ source: { type: 'local', path: 'clip.mp4' } })
      .catch((value: unknown) => value)

    expect(error).toMatchObject({
      name: 'ImportError', code: 'INVALID_CREATOR', message: 'Creator missing',
      action: 'Choose another creator', retryable: false
    })
  })

  it('invokes the exact failed-work deletion channel', async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: true })

    await expect(mocks.exposedApi!.deleteFailedWork('failed-1')).resolves.toBeUndefined()

    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workDeleteFailed, 'failed-1')
  })

  it('reconstructs the stable failed-work deletion error code', async () => {
    mocks.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FAILED_WORK_FILE_CLEANUP_FAILED', message: 'Failed work files could not be removed.' }
    })

    const error = await mocks.exposedApi!.deleteFailedWork('failed-1').catch((value: unknown) => value)

    expect(error).toMatchObject({
      name: 'DeleteFailedWorkError',
      code: 'FAILED_WORK_FILE_CLEANUP_FAILED',
      message: 'Failed work files could not be removed.'
    })
  })

  it('unwraps serialized Feishu connect and sync successes while leaving other Feishu routes unchanged', async () => {
    const connection = { status: 'connected', baseName: '对标内容雷达' }
    mocks.invoke
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce({ ok: true, value: connection })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, value: connection })
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(undefined)

    await expect(mocks.exposedApi!.getFeishuConnection()).resolves.toBe(connection)
    await expect(mocks.exposedApi!.connectFeishuCustomApp({
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })).resolves.toBe(connection)
    await expect(mocks.exposedApi!.openFeishuDeveloperConsole()).resolves.toBeUndefined()
    await expect(mocks.exposedApi!.disconnectFeishu()).resolves.toBeUndefined()
    await expect(mocks.exposedApi!.syncFeishu()).resolves.toBe(connection)
    await expect(mocks.exposedApi!.repairFeishu()).resolves.toBe(connection)
    await expect(mocks.exposedApi!.recreateFeishu()).resolves.toBe(connection)
    await expect(mocks.exposedApi!.openFeishuBase()).resolves.toBeUndefined()

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.feishuGet)
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.feishuConnectCustomApp, {
      appId: 'cli_example', appSecret: 'secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.feishuOpenDeveloperConsole)
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.feishuDisconnect)
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, IPC_CHANNELS.feishuSync)
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, IPC_CHANNELS.feishuRepair, undefined)
    expect(mocks.invoke).toHaveBeenNthCalledWith(7, IPC_CHANNELS.feishuRecreate)
    expect(mocks.invoke).toHaveBeenNthCalledWith(8, IPC_CHANNELS.feishuOpenBase)
  })

  it('exposes typed engine-health read and explicit refresh methods', async () => {
    const health = {
      cloud: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'profile-v1', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex-v1', code: null, message: null },
      checking: false
    }
    mocks.invoke.mockResolvedValueOnce(health).mockResolvedValueOnce(health).mockResolvedValueOnce(health)

    await expect(mocks.exposedApi!.peekEngineHealth()).resolves.toEqual(health)
    await expect(mocks.exposedApi!.getEngineHealth()).resolves.toEqual(health)
    await expect(mocks.exposedApi!.refreshEngineHealth()).resolves.toEqual(health)

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.engineHealthPeek)
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.engineHealthGet)
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.engineHealthRefresh)
    expect(JSON.stringify(health)).not.toMatch(/api.?key|bearer|prompt|stdout|stderr/i)
  })

  it('exposes the no-argument recommended-settings restore command', async () => {
    const restored = { analysisRecentDays: 30, analysisMaxWorksPerCreator: 10, feishuSyncMode: 'auto' }
    mocks.invoke.mockResolvedValueOnce(restored)

    await expect(mocks.exposedApi!.restoreRecommendedBehaviorSettings()).resolves.toEqual(restored)

    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsRestoreRecommended)
  })

  it('forwards targeted creator retries through their dedicated channel', async () => {
    mocks.invoke.mockResolvedValueOnce({ accepted: true })
    const request = { runId: 'run-1', creatorIds: ['creator-1', 'creator-2'] }

    await expect(mocks.exposedApi!.retryFailedCreators(request)).resolves.toEqual({ accepted: true })
    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.runRetryCreators, request)
  })

  it('reconstructs safe Errors from serialized Feishu connect and sync failures', async () => {
    const failure = {
      ok: false,
      error: {
        code: 'FEISHU_SECRET_INVALID', title: '应用凭证无效', reason: 'App ID 或 App Secret 不匹配',
        action: '请重新复制凭证后测试', retryable: false
      }
    }
    mocks.invoke.mockResolvedValueOnce(failure).mockResolvedValueOnce(failure)

    const connectError = await mocks.exposedApi!.connectFeishuCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    }).catch((value: unknown) => value)
    const syncError = await mocks.exposedApi!.syncFeishu().catch((value: unknown) => value)

    for (const error of [connectError, syncError]) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        name: 'FeishuError', message: 'FEISHU_SECRET_INVALID', code: 'FEISHU_SECRET_INVALID', title: '应用凭证无效',
        reason: 'App ID 或 App Secret 不匹配', action: '请重新复制凭证后测试', retryable: false
      })
      expect(String((error as Error).stack)).not.toContain('Error invoking remote method')
    }
  })

  it('rebuilds Feishu error copy from code instead of trusting serialized error text', async () => {
    mocks.invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'FEISHU_SECRET_INVALID', title: 'Bearer appSecret=LEAK', reason: 'raw-body=LEAK',
        action: 'stack: LEAK', retryable: true,
        message: 'appSecret=LEAK', stack: 'raw-body=LEAK', cause: 'Bearer LEAK'
      }
    })

    const error = await mocks.exposedApi!.syncFeishu().catch((value: unknown) => value) as Error & Record<string, unknown>

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'FeishuError', message: 'FEISHU_SECRET_INVALID', code: 'FEISHU_SECRET_INVALID', title: '应用凭证无效',
      reason: 'App ID 或 App Secret 不匹配', action: '请重新复制凭证后测试', retryable: false
    })
    expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toMatch(/appSecret=LEAK|raw-body=LEAK|stack: LEAK|Bearer LEAK/u)
    expect(error).not.toHaveProperty('cause')
  })

  it('turns malformed Feishu envelopes into the fixed safe error', async () => {
    const malformed = [
      undefined,
      null,
      {},
      { ok: true },
      { ok: false },
      { ok: false, error: null },
      { ok: false, error: { code: 'NOT_FEISHU', title: 'unsafe', reason: 'unsafe', action: 'unsafe', retryable: false } },
      { ok: false, error: { code: 'FEISHU_UNKNOWN_ERROR', title: 'unsafe', reason: 'unsafe', action: 'unsafe' } }
    ]

    for (const result of malformed) {
      mocks.invoke.mockResolvedValueOnce(result)
      const error = await mocks.exposedApi!.syncFeishu().catch((value: unknown) => value)

      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        name: 'FeishuError', message: 'FEISHU_UNKNOWN_ERROR', code: 'FEISHU_UNKNOWN_ERROR', title: '飞书操作失败',
        reason: '未能确认具体原因', action: '请重试；如仍失败，请检查应用配置', retryable: true
      })
    }
  })

  it('turns ipcRenderer Feishu rejections into the fixed safe error', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error(
      'Error invoking remote method feishu:sync: Bearer secret-token appSecret=LEAK raw-body=LEAK\nstack: private'
    ))

    const error = await mocks.exposedApi!.syncFeishu().catch((value: unknown) => value) as Error

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'FeishuError', message: 'FEISHU_UNKNOWN_ERROR', code: 'FEISHU_UNKNOWN_ERROR', title: '飞书操作失败',
      reason: '未能确认具体原因', action: '请重试；如仍失败，请检查应用配置', retryable: true
    })
    expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toMatch(
      /Error invoking remote method|Bearer secret-token|appSecret=LEAK|raw-body=LEAK|stack: private/u
    )
  })
})
