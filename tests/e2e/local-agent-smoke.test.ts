import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { AgentAuditService } from '../../src/services/agent/agent-audit-service'
import { AgentLifecycle } from '../../src/services/agent/agent-lifecycle'
import { CapabilityRegistry } from '../../src/services/agent/capability-registry'
import { createApplicationCapabilityRegistry } from '../../src/services/agent/application-capabilities'
import type { AgentApplicationFacade } from '../../src/services/agent/application-capabilities'

/**
 * End-to-end smoke: start the real loopback server from the real registry
 * (built on a stubbed application facade), discover capabilities, read a
 * transcript, write five-field analysis, and read it back through the same
 * registry — the exact flow the local Codex engine uses.
 */
describe('local Agent end-to-end smoke', () => {
  let lifecycle: AgentLifecycle | null = null
  let access: AgentAccessService | null = null
  let registry: CapabilityRegistry | null = null
  let stored: Array<{ workId: string; result: Record<string, unknown>; provider: string; model: string }> = []

  const facade: AgentApplicationFacade = {
    getDashboard: async () => ({ ready: true }),
    listCreators: async () => [{ id: 'c1', name: 'Creator' }],
    listWorks: async () => [{ id: 'w1', status: 'completed', stage: 'completed' }],
    getWork: async (id: string) => ({ id, transcript: '这是完整文字稿内容', analysis: null }),
    listRuns: async () => [],
    getSettings: async () => ({ providerId: 'deepseek' }),
    runNow: async () => ({ accepted: true }),
    addCreator: async (url: string) => ({ id: 'c2', profileUrl: url }),
    toggleCreator: async () => undefined,
    analyzeWork: async () => ({ accepted: true }),
    deleteCreator: async () => undefined,
    deleteRun: async () => undefined,
    clearUnclassifiedWorks: async () => undefined,
    listModelProfiles: async () => [],
    getModelProfile: async (id: string) => ({ id }),
    createModelProfile: async (input: unknown) => ({ id: 'p1', ...(input as object) }),
    updateModelProfile: async (id: string, input: unknown) => ({ id, ...(input as object) }),
    setActiveModelProfile: async (id: string) => ({ id, active: true }),
    setModelProfileApiKey: async () => undefined,
    deleteModelProfileApiKey: async () => undefined,
    testModelProfileConnection: async () => ({ executed: true, ok: true }),
    deleteModelProfile: async () => undefined,
    resetAgentToken: async () => 'new-token',
    startImport: async (request: unknown) => ({ accepted: true, request }),
    retryImport: async (workId: string) => ({ accepted: true, workId }),
    retryRun: async (id: string) => ({ accepted: true, id }),
    listPendingItems: async () => [{ id: 'w1', stage: 'transcribed', status: 'completed' }],
    saveSettings: async (input: unknown) => ({ ...(input as object) }),
    writeAnalysis: async (input: unknown) => {
      const payload = input as { workId: string; angle: string; hook: string; structure: string[]; explosion: string[]; highlights: string[]; modelId: string }
      stored.push({ workId: payload.workId, result: { angle: payload.angle, hook: payload.hook }, provider: 'local-agent', model: payload.modelId })
      return { ok: true, workId: payload.workId }
    }
  }

  beforeEach(() => {
    stored = []
    const settings = new Map<string, unknown>()
    const secrets = new Map<string, string>()
    access = new AgentAccessService({
      settings: {
        get: <T>(key: string) => (settings.get(key) as T | undefined) ?? null,
        set: (key: string, value: unknown) => { settings.set(key, value) }
      },
      secrets: {
        get: (key: string) => secrets.get(key) ?? null,
        set: (key: string, value: string) => { secrets.set(key, value) },
        delete: (key: string) => { secrets.delete(key) }
      }
    }, { randomBytes: (size) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 7 + size) % 256)) })
    const audits = new AgentAuditService({ create: () => undefined } as never)
    registry = createApplicationCapabilityRegistry(facade, { appVersion: '0.3.1', access })
    lifecycle = new AgentLifecycle({ registry, access, audits })
  })

  afterEach(async () => {
    if (lifecycle) await lifecycle.stop()
    lifecycle = null
    registry = null
    access = null
  })

  it('discovers capabilities, reads a transcript and writes five-field analysis through the registry', async () => {
    if (!access || !lifecycle || !registry) throw new Error('harness missing')
    const token = access.ensureToken()
    access.setEnabled(true)
    await lifecycle.start()
    const port = lifecycle.getState().port
    expect(port).toBeGreaterThan(0)
    if (!port) throw new Error('Agent lifecycle did not expose a loopback port')
    const base = `http://127.0.0.1:${port}/api/v1`

    // 1. Discover capabilities over the real HTTP server.
    const discovery = await fetch(`${base}/capabilities`, { headers: { authorization: `Bearer ${token}` } })
    expect(discovery.status).toBe(200)
    const manifest = await discovery.json() as { capabilities: Array<{ name: string }> }
    const names = manifest.capabilities.map((item) => item.name)
    expect(names).toContain('works.get')
    expect(names).toContain('analysis.write')
    expect(names).toContain('works.pending')

    // 2. Read one work with a transcript through the registry.
    const work = await registry.invoke('works.get', { id: 'w1' }, { source: 'mcp' })
    expect(work).toMatchObject({ id: 'w1', transcript: '这是完整文字稿内容' })

    // 3. Write structured analysis from the local Agent.
    const written = await registry.invoke('analysis.write', {
      workId: 'w1',
      category: '内容创作方法',
      keywords: ['选题系统', '内容策略'],
      angle: '角度A',
      hook: '钩子B',
      structure: ['开头', '结尾'],
      explosion: ['爆点C'],
      highlights: ['亮点D'],
      modelId: 'deepseek-v4-flash',
      schemaVersion: 'v1'
    }, { source: 'mcp' })
    expect(written).toMatchObject({ ok: true })

    // 4. Confirm the write reached the facade with provider=local-agent.
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ workId: 'w1', provider: 'local-agent', model: 'deepseek-v4-flash' })

  })
})
