import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), exposedApi: undefined as
  { onWorkStateChanged(listener: (workId: string) => void): () => void } | undefined }))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn((_name: string, api: NonNullable<typeof mocks.exposedApi>) => { mocks.exposedApi = api }) },
  ipcRenderer: { invoke: vi.fn(), on: mocks.on, removeListener: mocks.removeListener }
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
})
