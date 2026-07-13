import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn(), exposedApi: undefined as
  { onWorkStateChanged(listener: (workId: string) => void): () => void
    startImport(request: unknown): Promise<unknown> } | undefined }))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn((_name: string, api: NonNullable<typeof mocks.exposedApi>) => { mocks.exposedApi = api }) },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener }
}))

import '../../src/preload/index'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

describe('preload work events', () => {
  it('removes the exact handler registered for work state changes', () => {
    const listener = vi.fn()
    const unsubscribe = mocks.exposedApi!.onWorkStateChanged(listener)
    const handler = mocks.on.mock.calls.find(([channel]) => channel === IPC_CHANNELS.workStateChanged)?.[1]
    expect(handler).toBeTypeOf('function')

    unsubscribe()

    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.workStateChanged, handler)
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
})
