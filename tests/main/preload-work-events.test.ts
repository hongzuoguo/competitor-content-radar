import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn(), exposedApi: undefined as
  { onWorkStateChanged(listener: (workId: string) => void): () => void
    onWorkFocusRequested(listener: (request: { workId: string; requestId: string }) => void): () => void
    startImport(request: unknown): Promise<unknown>
    deleteFailedWork(workId: string): Promise<void>
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
  it('resolves a dropped File through Electron webUtils', () => {
    const file = new File(['video'], 'clip.mp4')
    mocks.getPathForFile.mockReturnValueOnce('C:\\clips\\clip.mp4')
    expect(mocks.exposedApi!.getPathForFile(file)).toBe('C:\\clips\\clip.mp4')
    expect(mocks.getPathForFile).toHaveBeenCalledWith(file)
  })

  it('removes the exact handler registered for work state changes', () => {
    const listener = vi.fn()
    const unsubscribe = mocks.exposedApi!.onWorkStateChanged(listener)
    const handler = mocks.on.mock.calls.find(([channel]) => channel === IPC_CHANNELS.workStateChanged)?.[1]
    expect(handler).toBeTypeOf('function')

    unsubscribe()

    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.workStateChanged, handler)
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
})
