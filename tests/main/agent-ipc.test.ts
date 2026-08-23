import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
  shell: { openExternal: vi.fn() }
}))

import { registerIpcHandlers, type IpcDependencies } from '../../src/main/ipc'
import { IPC_CHANNELS, type EngineHealthView } from '../../src/shared/ipc-contract'
import type { AgentManager } from '../../src/services/agent/agent-manager'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function agentManager(): AgentManager {
  return {
    getStatus: vi.fn(() => ({ enabled: true, running: true, port: 32100, address: 'http://127.0.0.1:32100', apiVersion: 'v1', error: null }))
  } as unknown as AgentManager
}

function dependencies(agent: AgentManager): IpcDependencies {
  return {
    getDashboard: vi.fn(), runNow: vi.fn(), listRuns: vi.fn(), retryRun: vi.fn(), deleteRun: vi.fn(),
    listCreators: vi.fn(), addCreator: vi.fn(),
    deleteCreator: vi.fn(), toggleCreator: vi.fn(), loginDouyin: vi.fn(), getSettings: vi.fn(),
    saveSettings: vi.fn(), restoreRecommendedBehaviorSettings: vi.fn(), startImport: vi.fn(), retryImport: vi.fn(), deleteFailedWork: vi.fn(),
    listWorks: vi.fn(), getWork: vi.fn(), analyzeWork: vi.fn(), clearUnclassifiedWorks: vi.fn(),
    getFeishuConnection: vi.fn(), connectFeishuCustomApp: vi.fn(), disconnectFeishu: vi.fn(),
    syncFeishu: vi.fn(), repairFeishu: vi.fn(), recreateFeishu: vi.fn(), openFeishuBase: vi.fn(),
    openFeishuDeveloperConsole: vi.fn(),
    agentManager: agent
  }
}

describe('local Agent IPC', () => {
  beforeEach(() => handlers.clear())

  it('reports agent status through the manager', async () => {
    const agent = agentManager()
    registerIpcHandlers(dependencies(agent))
    const status = await handlers.get(IPC_CHANNELS.agentStatus)?.({})
    expect(status).toMatchObject({ enabled: true, running: true, port: 32100 })
  })

  it('does not expose the Agent MCP configuration', () => {
    const agent = agentManager()
    registerIpcHandlers(dependencies(agent))
    expect(handlers.has('agent:mcp-config')).toBe(false)
  })

  it('does not persist agent detection diagnostics', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'main', 'ipc.ts'), 'utf8')

    expect(source).not.toContain('agent-probe.log')
    expect(source).not.toContain('appendFileSync')
  })

  it('marks a creator added through my account as mine', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.creatorAddMine)?.({}, 'https://www.douyin.com/user/mine')

    expect(deps.addCreator).toHaveBeenCalledWith({
      url: 'https://www.douyin.com/user/mine',
      ownership: 'mine'
    })
  })

  it('exposes one safe persisted engine-health view and refresh action', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const health: EngineHealthView = {
      cloud: { status: 'healthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'profile-v1', code: null, message: null },
      codex: { status: 'unhealthy', checkedAt: '2026-08-09T12:00:00.000Z', fingerprint: 'codex-v1', code: 'CODEX_LOGIN_REQUIRED', message: '请先登录 Codex。' },
      checking: false
    }
    const engineHealth = { peekPersisted: vi.fn(() => health), get: vi.fn(async () => health), refreshAll: vi.fn(async () => health), invalidateCloud: vi.fn(), invalidateCodex: vi.fn() }
    deps.engineHealth = engineHealth
    registerIpcHandlers(deps)

    expect(handlers.get(IPC_CHANNELS.engineHealthPeek)?.({})).toEqual(health)
    await expect(handlers.get(IPC_CHANNELS.engineHealthGet)?.({})).resolves.toEqual(health)
    await expect(handlers.get(IPC_CHANNELS.engineHealthRefresh)?.({})).resolves.toEqual(health)
    expect(engineHealth.peekPersisted).toHaveBeenCalledOnce()
    expect(engineHealth.get).toHaveBeenCalledOnce()
    expect(engineHealth.refreshAll).toHaveBeenCalledOnce()
    expect(JSON.stringify(health)).not.toMatch(/api.?key|bearer|prompt|stdout|stderr/i)
  })

  it('routes recommended-settings restore through the narrow no-argument handler', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    vi.mocked(deps.restoreRecommendedBehaviorSettings).mockResolvedValue({ analysisRecentDays: 30, analysisMaxWorksPerCreator: 10 })
    registerIpcHandlers(deps)

    await expect(handlers.get(IPC_CHANNELS.settingsRestoreRecommended)?.({})).resolves.toMatchObject({
      analysisRecentDays: 30,
      analysisMaxWorksPerCreator: 10
    })
    expect(deps.restoreRecommendedBehaviorSettings).toHaveBeenCalledOnce()
  })

  it('does not let a rejected health invalidation turn an IPC mutation into a failure', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const engineHealth = {
      peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(),
      invalidateCloud: vi.fn(async () => { throw new Error('ENGINE_HEALTH_INVALIDATION_FAILED') }),
      invalidateCodex: vi.fn(async () => { throw new Error('ENGINE_HEALTH_INVALIDATION_FAILED') })
    }
    deps.engineHealth = engineHealth
    deps.modelProfiles = {
      list: vi.fn(),
      create: vi.fn(() => ({ id: 'profile-1' })),
      update: vi.fn(),
      testConnection: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    } as never
    vi.mocked(deps.saveSettings)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ agentModel: 'gpt-5.6-terra' })
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.modelProfileCreate)?.({}, {
      name: 'Cloud', providerTemplate: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    })
    await handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', {
      name: 'Cloud', providerTemplate: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true, apiKey: 'new-key'
    })
    await handlers.get(IPC_CHANNELS.modelProfileActivate)?.({}, 'profile-1')
    await handlers.get(IPC_CHANNELS.modelProfileDeleteKey)?.({}, 'profile-1')
    await handlers.get(IPC_CHANNELS.modelProfileDelete)?.({}, 'profile-1')
    await handlers.get(IPC_CHANNELS.settingsSave)?.({}, { dailyTime: '09:00' })
    await handlers.get(IPC_CHANNELS.settingsSave)?.({}, { agentModel: 'gpt-5.6-terra' })

    expect(engineHealth.invalidateCloud).not.toHaveBeenCalled()
    expect(engineHealth.invalidateCodex).not.toHaveBeenCalled()
  })

  it('reuses a tested saved key only after the unchanged active profile is saved', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const draft = {
      name: 'Cloud', providerTemplate: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    }
    const profile = { id: 'profile-1', ...draft, active: true, apiKeyConfigured: true, createdAt: '', updatedAt: 'before' }
    const recordCloudSuccess = vi.fn(async () => undefined)
    deps.engineHealth = { peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(), recordCloudSuccess }
    deps.modelProfiles = {
      list: vi.fn(), create: vi.fn(), update: vi.fn(() => profile), testConnection: vi.fn(async () => ({ executed: true, ok: true })),
      setActive: vi.fn(), delete: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(),
      get: vi.fn(() => profile),
      getActiveHealthIdentity: vi.fn(() => ({
        id: 'profile-1', providerTemplate: 'deepseek', baseUrl: draft.baseUrl, modelId: draft.modelId,
        updatedAt: 'before', credentialRevision: 4
      }))
    } as never
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.modelProfileTest)?.({}, { ...draft, profileId: 'profile-1' })
    await handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', draft)

    expect(recordCloudSuccess).toHaveBeenCalledOnce()
  })

  it('does not reuse a test that supplied a replacement key or changed draft', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const draft = {
      name: 'Cloud', providerTemplate: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    }
    const profile = { id: 'profile-1', ...draft, active: true, apiKeyConfigured: true, createdAt: '', updatedAt: 'before' }
    const recordCloudSuccess = vi.fn(async () => undefined)
    deps.engineHealth = { peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(), recordCloudSuccess }
    deps.modelProfiles = {
      list: vi.fn(), create: vi.fn(), update: vi.fn(() => profile), testConnection: vi.fn(async () => ({ executed: true, ok: true })),
      setActive: vi.fn(), delete: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(), get: vi.fn(() => profile),
      getActiveHealthIdentity: vi.fn(() => ({ id: 'profile-1', providerTemplate: 'deepseek', baseUrl: draft.baseUrl, modelId: draft.modelId, updatedAt: 'before', credentialRevision: 4 }))
    } as never
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.modelProfileTest)?.({}, { ...draft, profileId: 'profile-1', apiKey: 'replacement-key' })
    await handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', { ...draft, modelId: 'different-model' })

    expect(recordCloudSuccess).not.toHaveBeenCalled()
  })

  it('does not reject a committed profile save when recording verified health fails', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const draft = {
      name: 'Cloud', providerTemplate: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    }
    const profile = { id: 'profile-1', ...draft, active: true, apiKeyConfigured: true, createdAt: '', updatedAt: 'before' }
    deps.engineHealth = { peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(), recordCloudSuccess: vi.fn(async () => { throw new Error('raw secret failure') }) }
    deps.modelProfiles = {
      list: vi.fn(), create: vi.fn(), update: vi.fn(() => profile), testConnection: vi.fn(async () => ({ executed: true, ok: true })),
      setActive: vi.fn(), delete: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(), get: vi.fn(() => profile),
      getActiveHealthIdentity: vi.fn(() => ({ id: 'profile-1', providerTemplate: 'deepseek', baseUrl: draft.baseUrl, modelId: draft.modelId, updatedAt: 'before', credentialRevision: 4 }))
    } as never
    registerIpcHandlers(deps)

    await handlers.get(IPC_CHANNELS.modelProfileTest)?.({}, { ...draft, profileId: 'profile-1' })
    await expect(handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', draft)).resolves.toMatchObject({ id: 'profile-1' })
  })

  it('rejects ticket reuse after failed tests, configuration revisions, activation changes, expiry, or draft mismatch', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const draft = {
      name: 'Cloud', providerTemplate: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    }
    let testOk = false
    let active = true
    let credentialRevision = 4
    let updatedAt = 'before'
    const profile = () => ({ id: 'profile-1', ...draft, active, apiKeyConfigured: true, createdAt: '', updatedAt })
    const recordCloudSuccess = vi.fn(async () => undefined)
    deps.engineHealth = { peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(), recordCloudSuccess }
    deps.modelProfiles = {
      list: vi.fn(), create: vi.fn(), update: vi.fn(() => profile()), testConnection: vi.fn(async () => ({ executed: true, ok: testOk })),
      setActive: vi.fn(), delete: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(), get: vi.fn(() => profile()),
      getActiveHealthIdentity: vi.fn(() => active ? ({ id: 'profile-1', providerTemplate: 'deepseek', baseUrl: draft.baseUrl, modelId: draft.modelId, updatedAt, credentialRevision }) : null)
    } as never
    registerIpcHandlers(deps)
    const test = async () => handlers.get(IPC_CHANNELS.modelProfileTest)?.({}, { ...draft, profileId: 'profile-1' })
    const save = async (value = draft) => handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', value)

    await test()
    await save()
    testOk = true
    await test()
    credentialRevision += 1
    await save()
    credentialRevision -= 1
    await test()
    updatedAt = 'after'
    await save()
    updatedAt = 'before'
    await test()
    active = false
    await save()
    active = true
    await test()
    await save({ ...draft, modelId: 'changed-after-test' })
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(60_001)
    await test()
    await save()
    clock.mockRestore()

    expect(recordCloudSuccess).not.toHaveBeenCalled()
  })

  it('does not issue a ticket when the active key revision changes while the test is in flight', async () => {
    const agent = agentManager()
    const deps = dependencies(agent)
    const testResult = deferred<{ executed: boolean, ok: boolean }>()
    const draft = {
      name: 'Cloud', providerTemplate: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat', requiresApiKey: true, enabled: true
    }
    let credentialRevision = 4
    const profile = { id: 'profile-1', ...draft, active: true, apiKeyConfigured: true, createdAt: '', updatedAt: 'before' }
    const recordCloudSuccess = vi.fn(async () => undefined)
    deps.engineHealth = { peekPersisted: vi.fn(), get: vi.fn(), refreshAll: vi.fn(), recordCloudSuccess }
    deps.modelProfiles = {
      list: vi.fn(), create: vi.fn(), update: vi.fn(() => profile), testConnection: vi.fn(() => testResult.promise),
      setActive: vi.fn(), delete: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(), get: vi.fn(() => profile),
      getActiveHealthIdentity: vi.fn(() => ({ id: 'profile-1', providerTemplate: 'deepseek', baseUrl: draft.baseUrl, modelId: draft.modelId, updatedAt: 'before', credentialRevision }))
    } as never
    registerIpcHandlers(deps)

    const testing = handlers.get(IPC_CHANNELS.modelProfileTest)?.({}, { ...draft, profileId: 'profile-1' }) as Promise<unknown>
    credentialRevision = 5
    testResult.resolve({ executed: true, ok: true })
    await testing
    await handlers.get(IPC_CHANNELS.modelProfileUpdate)?.({}, 'profile-1', draft)

    expect(recordCloudSuccess).not.toHaveBeenCalled()
  })
})
