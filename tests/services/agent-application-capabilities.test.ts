import { describe, expect, it, vi } from 'vitest'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { AgentCapabilityError } from '../../src/services/agent/agent-contract'
import { createApplicationCapabilityRegistry } from '../../src/services/agent/application-capabilities'

function runtime() {
  return {
    getDashboard: vi.fn(async () => ({ ready: true })),
    listCreators: vi.fn(async () => [{ id: 'c1', name: 'Creator' }]),
    listWorks: vi.fn(async () => [{ id: 'w1', title: 'Work' }]),
    getWork: vi.fn(async (id: string) => ({ id, transcript: 'hello', analysis: null })),
    listRuns: vi.fn(async () => [{ id: 'r1', status: 'completed' }]),
    getSettings: vi.fn(async () => ({ providerId: 'deepseek' })),
    runNow: vi.fn(async () => ({ accepted: true })),
    addCreator: vi.fn(async (url: string) => ({ id: 'c2', profileUrl: url })),
    toggleCreator: vi.fn(async () => undefined),
    analyzeWork: vi.fn(async () => ({ accepted: true })),
    deleteCreator: vi.fn(async () => undefined),
    deleteRun: vi.fn(async () => undefined),
    clearUnclassifiedWorks: vi.fn(async () => undefined),
    deleteModelProfile: vi.fn(async () => undefined),
    resetAgentToken: vi.fn(async () => 'new-token'),
    listModelProfiles: vi.fn(async () => [{ id: 'p1', name: 'DeepSeek' }]),
    getModelProfile: vi.fn(async (id: string) => ({ id, name: 'DeepSeek' })),
    createModelProfile: vi.fn(async (input: unknown) => ({ id: 'p2', ...(input as object) })),
    updateModelProfile: vi.fn(async (id: string, input: unknown) => ({ id, ...(input as object) })),
    setActiveModelProfile: vi.fn(async (id: string) => ({ id, active: true })),
    setModelProfileApiKey: vi.fn(async () => undefined),
    deleteModelProfileApiKey: vi.fn(async () => undefined),
    testModelProfileConnection: vi.fn(async () => ({ executed: true, ok: true })),
    startImport: vi.fn(async (request: unknown) => ({ accepted: true, request })),
    retryImport: vi.fn(async (workId: string) => ({ accepted: true, workId })),
    retryRun: vi.fn(async (id: string) => ({ accepted: true, id })),
    listPendingItems: vi.fn(async () => [{ id: 'w1', reason: 'transcript' }]),
    saveSettings: vi.fn(async (input: unknown) => ({ ...(input as object) })),
    writeAnalysis: vi.fn(async (input: unknown) => ({ ok: true, ...(input as object) }))
  }
}

function access() {
  const settings = new Map<string, unknown>()
  const secrets = new Map<string, string>()
  const service = new AgentAccessService({
    settings: {
      get: <T>(key: string) => (settings.get(key) as T | undefined) ?? null,
      set: (key: string, value: unknown) => { settings.set(key, value) }
    },
    secrets: {
      get: (key: string) => secrets.get(key) ?? null,
      set: (key: string, value: string) => { secrets.set(key, value) },
      delete: (key: string) => { secrets.delete(key) }
    }
  }, { randomBytes: (size) => Buffer.alloc(size, 7), now: () => 1_000 })
  return service
}

function registry(facade = runtime()) {
  const service = access()
  return {
    registry: createApplicationCapabilityRegistry(facade, { appVersion: '0.3.1', access: service }),
    access: service,
    facade
  }
}

describe('application Agent capabilities', () => {
  it('exposes core reads and normal writes through the registry', async () => {
    const facade = runtime()
    const service = access()
    const reg = createApplicationCapabilityRegistry(facade, { appVersion: '0.3.1', access: service })

    await expect(reg.invoke('creators.list', {}, { source: 'local-api' }))
      .resolves.toEqual([{ id: 'c1', name: 'Creator' }])
    await expect(reg.invoke('works.get', { id: 'w1' }, { source: 'mcp' }))
      .resolves.toEqual({ id: 'w1', transcript: 'hello', analysis: null })
    await expect(reg.invoke('runs.start', {}, { source: 'local-api' }))
      .resolves.toEqual({ accepted: true })
    expect(facade.runNow).toHaveBeenCalledOnce()
  })

  it('does not include secrets in settings capability output', async () => {
    const facade = runtime()
    const service = access()
    const reg = createApplicationCapabilityRegistry(facade, { appVersion: '0.3.1', access: service })
    const output = await reg.invoke('settings.get', {}, { source: 'local-api' })
    expect(JSON.stringify(output)).not.toContain('apiKey')
  })

  it('exposes model profile management as normal write capabilities', async () => {
    const { registry: reg, facade } = registry()
    await expect(reg.invoke('modelProfiles.list', {}, { source: 'local-api' }))
      .resolves.toEqual([{ id: 'p1', name: 'DeepSeek' }])
    await expect(reg.invoke('modelProfiles.get', { id: 'p1' }, { source: 'local-api' }))
      .resolves.toEqual({ id: 'p1', name: 'DeepSeek' })
    await reg.invoke('modelProfiles.create', {
      profile: {
        name: 'Kimi',
        providerTemplate: 'kimi',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'kimi-k2',
        requiresApiKey: false,
        enabled: true
      }
    }, { source: 'mcp' })
    expect(facade.createModelProfile).toHaveBeenCalledWith({
      name: 'Kimi',
      providerTemplate: 'kimi',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'kimi-k2',
      requiresApiKey: false,
      enabled: true
    }, undefined)
    await reg.invoke('modelProfiles.setApiKey', { id: 'p1', apiKey: 'sk-test' }, { source: 'mcp' })
    expect(facade.setModelProfileApiKey).toHaveBeenCalledWith('p1', 'sk-test')
  })

  it('exposes import, retry and pending reads', async () => {
    const { registry: reg, facade } = registry()
    await reg.invoke('imports.start', { request: { source: { type: 'local', path: '/tmp/a.mp4' } } }, { source: 'local-api' })
    expect(facade.startImport).toHaveBeenCalledWith({ source: { type: 'local', path: '/tmp/a.mp4' } })
    await reg.invoke('imports.retry', { workId: 'w9' }, { source: 'mcp' })
    expect(facade.retryImport).toHaveBeenCalledWith('w9')
    await reg.invoke('runs.retry', { id: 'r1' }, { source: 'mcp' })
    expect(facade.retryRun).toHaveBeenCalledWith('r1')
    await expect(reg.invoke('works.pending', {}, { source: 'local-api' }))
      .resolves.toEqual([{ id: 'w1', reason: 'transcript' }])
  })

  it('requires two-step confirmation for dangerous deletes', async () => {
    const { registry: reg, access: service, facade } = registry()
    const first = await reg.invoke('creators.delete', { id: 'c1' }, { source: 'local-api' })
    expect(first).toMatchObject({ confirmation: { token: expect.any(String) } })
    expect(facade.deleteCreator).not.toHaveBeenCalled()

    const token = (first as { confirmation: { token: string } }).confirmation.token
    await reg.invoke('creators.delete', { id: 'c1' }, { source: 'local-api', confirmationToken: token })
    expect(facade.deleteCreator).toHaveBeenCalledWith('c1')

    expect(() => service.consumeConfirmation(token, 'creators.delete', { id: 'c1' })).not.toThrow()
  })

  it('rejects a stale or mismatched confirmation token for dangerous deletes', async () => {
    const { registry: reg, facade } = registry()
    const first = await reg.invoke('runs.delete', { id: 'r1' }, { source: 'local-api' })
    const token = (first as { confirmation: { token: string } }).confirmation.token
    await expect(
      reg.invoke('runs.delete', { id: 'r1' }, { source: 'local-api', confirmationToken: token })
    ).resolves.toEqual({ ok: true })
    await expect(
      reg.invoke('runs.delete', { id: 'r1' }, { source: 'local-api', confirmationToken: token })
    ).rejects.toMatchObject({ code: 'AGENT_CONFIRMATION_REQUIRED' })
    expect(facade.deleteRun).toHaveBeenCalledTimes(1)
  })

  it('writes local-Agent five-field analysis through analysis.write', async () => {
    const { registry: reg, facade } = registry()
    const input = {
      workId: 'w1',
      category: 'AI工具测评',
      keywords: ['工具对比', '实测体验', '避坑建议'],
      angle: '角度A',
      hook: '钩子B',
      structure: ['开头', '结尾'],
      explosion: ['爆点C'],
      highlights: ['亮点D'],
      modelId: 'deepseek-v4-flash',
      schemaVersion: 'v1'
    }
    const output = await reg.invoke('analysis.write', input, { source: 'mcp' })
    expect(output).toMatchObject({ ok: true })
    expect(facade.writeAnalysis).toHaveBeenCalledWith(input)
  })

  it('rejects analysis.write without a concrete category and two keywords', async () => {
    const { registry: reg, facade } = registry()
    await expect(reg.invoke('analysis.write', {
      workId: 'w1', category: 'AI', keywords: ['测试'], angle: '角度', hook: '钩子',
      structure: ['结构'], explosion: [], highlights: [], modelId: 'codex', schemaVersion: 'v2'
    }, { source: 'mcp' })).rejects.toBeInstanceOf(AgentCapabilityError)
    expect(facade.writeAnalysis).not.toHaveBeenCalled()
  })

  it('rejects analysis.write with a missing required field', async () => {
    const { registry: reg, facade } = registry()
    await expect(
      reg.invoke('analysis.write', { workId: 'w1', angle: 'A' }, { source: 'mcp' })
    ).rejects.toBeInstanceOf(AgentCapabilityError)
    expect(facade.writeAnalysis).not.toHaveBeenCalled()
  })
})
