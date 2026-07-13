import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  shell: { openExternal: vi.fn() }
}))

import { registerIpcHandlers, type IpcDependencies } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'

function dependencies(): IpcDependencies {
  return {
    getDashboard: vi.fn(), runNow: vi.fn(), listCreators: vi.fn(), addCreator: vi.fn(),
    deleteCreator: vi.fn(), toggleCreator: vi.fn(), loginDouyin: vi.fn(), getSettings: vi.fn(),
    saveSettings: vi.fn(), startImport: vi.fn(), retryImport: vi.fn(), listWorks: vi.fn()
  }
}

describe('import IPC', () => {
  beforeEach(() => handlers.clear())

  it('opens a constrained video picker and returns only the first absolute path', async () => {
    const deps = dependencies()
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['C:\\clips\\one.mp4', 'C:\\clips\\two.mp4'] }))
    registerIpcHandlers(deps, undefined, { showOpenDialog })

    await expect(handlers.get(IPC_CHANNELS.importPickLocal)?.({})).resolves.toBe('C:\\clips\\one.mp4')
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm'] }]
    })
  })

  it('returns null when the picker is cancelled', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }))
    registerIpcHandlers(dependencies(), undefined, { showOpenDialog })
    await expect(handlers.get(IPC_CHANNELS.importPickLocal)?.({})).resolves.toBeNull()
  })

  it.each([
    null, [], {}, { type: 'unknown', path: 'x', creatorId: null },
    { type: 'local', path: '', creatorId: null }, { type: 'local', path: 'x', creatorId: 3 },
    { type: 'douyin', url: '', creatorId: null }, Object.assign(Object.create({ polluted: true }), { type: 'local', path: 'x', creatorId: null })
  ])('rejects invalid import payload %# without calling the service', async (payload) => {
    const deps = dependencies()
    registerIpcHandlers(deps)
    await expect(Promise.resolve().then(() => handlers.get(IPC_CHANNELS.importStart)?.({}, payload))).rejects.toThrow('INVALID_IMPORT_REQUEST')
    expect(deps.startImport).not.toHaveBeenCalled()
  })

  it('passes a sanitized import request and validates retry ids', async () => {
    const deps = dependencies()
    vi.mocked(deps.startImport).mockResolvedValue({ accepted: true, workId: 'work-1' })
    registerIpcHandlers(deps)
    await handlers.get(IPC_CHANNELS.importStart)?.({}, { type: 'local', path: ' clip.mp4 ', creatorId: null, ignored: 'value' })
    expect(deps.startImport).toHaveBeenCalledWith({ type: 'local', path: 'clip.mp4', creatorId: null })
    await expect(Promise.resolve().then(() => handlers.get(IPC_CHANNELS.importRetry)?.({}, ' '))).rejects.toThrow('INVALID_IMPORT_RETRY')
    expect(deps.retryImport).not.toHaveBeenCalled()
  })
})
