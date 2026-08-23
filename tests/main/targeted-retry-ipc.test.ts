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
    getDashboard: vi.fn(), runNow: vi.fn(), listRuns: vi.fn(), retryRun: vi.fn(), retryFailedCreators: vi.fn(), deleteRun: vi.fn(),
    listCreators: vi.fn(), addCreator: vi.fn(), deleteCreator: vi.fn(), toggleCreator: vi.fn(), clearUnclassifiedWorks: vi.fn(),
    loginDouyin: vi.fn(), logoutDouyin: vi.fn(), checkDouyinLogin: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(),
    restoreRecommendedBehaviorSettings: vi.fn(), startImport: vi.fn(), retryImport: vi.fn(), deleteFailedWork: vi.fn(),
    listWorks: vi.fn(), getWork: vi.fn(), analyzeWork: vi.fn(), getFeishuConnection: vi.fn(), connectFeishuCustomApp: vi.fn(),
    disconnectFeishu: vi.fn(), syncFeishu: vi.fn(), repairFeishu: vi.fn(), recreateFeishu: vi.fn(), openFeishuBase: vi.fn(),
    openFeishuDeveloperConsole: vi.fn()
  }
}

describe('targeted creator retry IPC', () => {
  beforeEach(() => handlers.clear())

  it('forwards one normalized all-or-nothing request', async () => {
    const deps = dependencies()
    vi.mocked(deps.retryFailedCreators).mockResolvedValue({ accepted: true })
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.runRetryCreators)?.({}, {
      runId: ' run-1 ', creatorIds: [' creator-1 ', 'creator-2']
    })).resolves.toEqual({ accepted: true })
    expect(deps.retryFailedCreators).toHaveBeenCalledWith({ runId: 'run-1', creatorIds: ['creator-1', 'creator-2'] })
  })

  it.each([
    undefined,
    null,
    {},
    { runId: '', creatorIds: ['creator-1'] },
    { runId: 'x'.repeat(201), creatorIds: ['creator-1'] },
    { runId: 'run-1', creatorIds: [] },
    { runId: 'run-1', creatorIds: [''] },
    { runId: 'run-1', creatorIds: ['creator-1', 'creator-1'] },
    { runId: 'run-1', creatorIds: ['x'.repeat(201)] },
    { runId: 'https://host/run', creatorIds: ['creator-1'] },
    { runId: 'run-1', creatorIds: ['creator/1'] },
    { runId: 'run-1', creatorIds: ['creator:1'] },
    { runId: 'run-1', creatorIds: ['C:\\private'] },
    { runId: 'run-1', creatorIds: Array.from({ length: 11 }, (_, index) => `creator-${index}`) }
  ])('rejects malformed input without dispatching: %j', async (value) => {
    const deps = dependencies()
    registerIpcHandlers(deps)

    await expect(Promise.resolve().then(() => handlers.get(IPC_CHANNELS.runRetryCreators)?.({}, value)))
      .rejects.toThrow('INVALID_TARGETED_RETRY')
    expect(deps.retryFailedCreators).not.toHaveBeenCalled()
    expect(deps.runNow).not.toHaveBeenCalled()
    expect(deps.retryRun).not.toHaveBeenCalled()
  })
})
