import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  shell: { openExternal: vi.fn() }
}))

import { registerIpcHandlers, type IpcDependencies } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc-contract'
import { ImportError } from '../../src/services/import/import-errors'

function dependencies(): IpcDependencies {
  return {
    getDashboard: vi.fn(), runNow: vi.fn(), listCreators: vi.fn(), addCreator: vi.fn(),
    deleteCreator: vi.fn(), toggleCreator: vi.fn(), loginDouyin: vi.fn(), getSettings: vi.fn(),
    saveSettings: vi.fn(), startImport: vi.fn(), retryImport: vi.fn(), deleteFailedWork: vi.fn(), listWorks: vi.fn()
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
    null, [], {}, { source: { type: 'unknown', path: 'x' }, creatorId: null },
    { source: { type: 'local', path: '' }, creatorId: null }, { source: { type: 'local', path: 'x' }, creatorId: 3 },
    { source: { type: 'douyin_url', url: '' }, creatorId: null },
    { source: Object.assign(Object.create({ polluted: true }), { type: 'local', path: 'x' }), creatorId: null },
    Object.assign(Object.create({ polluted: true }), { source: { type: 'local', path: 'x' }, creatorId: null })
  ])('rejects invalid import payload %# without calling the service', async (payload) => {
    const deps = dependencies()
    registerIpcHandlers(deps)
    await expect(handlers.get(IPC_CHANNELS.importStart)?.({}, payload)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_IMPORT_REQUEST', retryable: false }
    })
    expect(deps.startImport).not.toHaveBeenCalled()
  })

  it('passes a sanitized import request and validates retry ids', async () => {
    const deps = dependencies()
    vi.mocked(deps.startImport).mockResolvedValue({ accepted: true, workId: 'work-1' })
    registerIpcHandlers(deps)
    await handlers.get(IPC_CHANNELS.importStart)?.({}, { source: { type: 'local', path: ' clip.mp4 ', ignored: 'value' }, ignored: 'value' })
    expect(deps.startImport).toHaveBeenCalledWith({ source: { type: 'local', path: 'clip.mp4' }, creatorId: null })
    await expect(handlers.get(IPC_CHANNELS.importRetry)?.({}, ' ')).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_IMPORT_RETRY', retryable: false }
    })
    expect(deps.retryImport).not.toHaveBeenCalled()
  })

  it('serializes import failures into a stable result envelope', async () => {
    const deps = dependencies()
    vi.mocked(deps.startImport).mockRejectedValue(new ImportError('INVALID_CREATOR', 'Creator missing', {
      action: 'Choose another creator', retryable: false
    }))
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.importStart)?.({}, {
      source: { type: 'local', path: 'clip.mp4' }, creatorId: 'missing'
    })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_CREATOR', message: 'Creator missing', action: 'Choose another creator', retryable: false }
    })
  })

  it('trims failed-work ids before deletion and rejects blank ids', async () => {
    const deps = dependencies()
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.workDeleteFailed)?.({}, ' failed-1 ')).resolves.toEqual({ ok: true })
    expect(deps.deleteFailedWork).toHaveBeenCalledWith('failed-1')

    await expect(handlers.get(IPC_CHANNELS.workDeleteFailed)?.({}, ' ')).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_WORK_DELETE', message: 'A work id is required.' }
    })
    expect(deps.deleteFailedWork).toHaveBeenCalledTimes(1)
  })

  it('sanitizes failed-work deletion errors without exposing extra metadata', async () => {
    const deps = dependencies()
    const source = Object.assign(new Error('Cleanup failed'), {
      code: 'FAILED_WORK_FILE_CLEANUP_FAILED', path: 'C:\\private\\media\\failed-1', action: 'inspect disk'
    })
    vi.mocked(deps.deleteFailedWork).mockRejectedValue(source)
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.workDeleteFailed)?.({}, 'failed-1')).resolves.toEqual({
      ok: false,
      error: { code: 'FAILED_WORK_FILE_CLEANUP_FAILED', message: 'Cleanup failed' }
    })
  })
})
