import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { AgentAuditService } from '../../src/services/agent/agent-audit-service'
import { AgentLifecycle } from '../../src/services/agent/agent-lifecycle'
import { AgentManager } from '../../src/services/agent/agent-manager'
import { CapabilityRegistry } from '../../src/services/agent/capability-registry'

function harness() {
  const settings = new Map<string, unknown>()
  const secrets = new Map<string, string>()
  const audits: Array<Record<string, unknown>> = []
  let randomCounter = 0
  const access = new AgentAccessService({
    settings: {
      get: <T>(key: string) => (settings.get(key) as T | undefined) ?? null,
      set: (key: string, value: unknown) => { settings.set(key, value) }
    },
    secrets: {
      get: (key: string) => secrets.get(key) ?? null,
      set: (key: string, value: string) => { secrets.set(key, value) },
      delete: (key: string) => { secrets.delete(key) }
    }
  }, {
    randomBytes: (size) => Buffer.from(Array.from({ length: size }, (_, index) => (randomCounter++ + index) % 256)),
    now: () => 1_000
  })
  const auditsService = new AgentAuditService({
    create: (record: Record<string, unknown>) => { audits.push(record) }
  })
  const registry = new CapabilityRegistry({ appVersion: '0.3.1' })
  registry.register({
    name: 'app.status',
    description: 'Read application status.',
    permission: 'app.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
    outputSchema: { safeParse: () => ({ success: true, data: { ready: true } }) } as never,
    handler: async () => ({ ready: true })
  })
  const lifecycle = new AgentLifecycle({ registry, access, audits: auditsService })
  const manager = new AgentManager({ access, lifecycle })
  return { settings, secrets, access, audits, auditsService, lifecycle, manager }
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

function createNetServer() {
  // Lazy import so Electron-only code paths never load in Node tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:http').createServer()
}

describe('AgentLifecycle', () => {
  it('starts the service on a loopback port and reports running status', async () => {
    const { manager, lifecycle, access } = harness()
    access.ensureToken()
    access.setEnabled(true)
    const { port } = await lifecycle.start()

    expect(port).toBeGreaterThan(0)
    const status = manager.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.running).toBe(true)
    expect(status.port).toBe(port)
    expect(status.address).toBe(`http://127.0.0.1:${port}`)
    expect(access.getState().port).toBe(port)
  })

  it('stops both transports and reports stopped status', async () => {
    const { manager, lifecycle, access } = harness()
    access.ensureToken()
    access.setEnabled(true)
    await lifecycle.start()
    await lifecycle.stop()

    const status = manager.getStatus()
    expect(status.running).toBe(false)
    expect(status.port).toBe(null)
  })

})
