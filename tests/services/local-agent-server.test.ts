import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { CapabilityRegistry } from '../../src/services/agent/capability-registry'
import { createLocalAgentServer, type LocalAgentServerHandle } from '../../src/services/agent/local-agent-server'

function registry(): CapabilityRegistry {
  const reg = new CapabilityRegistry({ appVersion: '0.3.1' })
  reg.register({
    name: 'app.status',
    description: 'Read application status.',
    permission: 'app.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema: new Proxy({}, { get: () => () => ({ success: true, data: {} }) }),
    outputSchema: new Proxy({}, { get: () => () => ({ success: true, data: { ready: true } }) }),
    handler: async () => ({ ready: true })
  })
  reg.register({
    name: 'echo',
    description: 'Echo the payload back for tests.',
    permission: 'data.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema: new Proxy({}, { get: () => () => ({ success: true, data: { value: 'x' } }) }),
    outputSchema: new Proxy({}, { get: () => () => ({ success: true, data: { value: 'x' } }) }),
    handler: async (input: unknown) => input
  })
  return reg
}

function access(): AgentAccessService {
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
  service.ensureToken()
  return service
}

function portOf(handle: LocalAgentServerHandle): number {
  return (handle.server.address() as AddressInfo).port
}

async function requestJson(handle: LocalAgentServerHandle, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> | string }> {
  const url = `http://127.0.0.1:${portOf(handle)}${path}`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let parsed: Record<string, unknown> | string = text
  try { parsed = JSON.parse(text) as Record<string, unknown> } catch { parsed = text }
  return { status: response.status, body: parsed }
}

describe('LocalAgentServer', () => {
  let handle: LocalAgentServerHandle | null = null
  let server: Server | null = null

  beforeEach(() => {
    handle = null
    server = null
  })

  afterEach(async () => {
    if (handle) await handle.close()
    if (server) server.close()
  })

  it('binds only to the loopback interface and reports health without auth', async () => {
    const result = createLocalAgentServer({ registry: registry(), access: access() })
    handle = result.handle
    await handle.listen(0)
    const address = handle.server.address() as AddressInfo
    expect(address.address).toBe('127.0.0.1')

    const health = await requestJson(handle, 'GET', '/api/v1/health')
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ ok: true, apiVersion: 'v1' })
  })

  it('requires a bearer token for capabilities and invoke', async () => {
    const service = access()
    const result = createLocalAgentServer({ registry: registry(), access: service })
    handle = result.handle
    await handle.listen(0)
    const token = service.ensureToken()

    const noAuth = await requestJson(handle, 'GET', '/api/v1/capabilities')
    expect(noAuth.status).toBe(401)

    const wrongAuth = await requestJson(handle, 'GET', '/api/v1/capabilities', undefined, 'wrong-token')
    expect(wrongAuth.status).toBe(401)

    const withAuth = await requestJson(handle, 'GET', '/api/v1/capabilities', undefined, token)
    expect(withAuth.status).toBe(200)
    expect((withAuth.body as { capabilities?: unknown[] }).capabilities).toBeDefined()
  })

  it('invokes a capability through the registry with the same auth', async () => {
    const service = access()
    const result = createLocalAgentServer({ registry: registry(), access: service })
    handle = result.handle
    await handle.listen(0)
    const token = service.ensureToken()

    const invoked = await requestJson(handle, 'POST', '/api/v1/invoke', { capability: 'app.status', input: {} }, token)
    expect(invoked.status).toBe(200)
    expect(invoked.body).toEqual({ ok: true, result: { ready: true } })

    const unknown = await requestJson(handle, 'POST', '/api/v1/invoke', { capability: 'nope', input: {} }, token)
    expect(unknown.status).toBe(404)
    expect((unknown.body as { error?: { code: string } }).error?.code).toBe('AGENT_CAPABILITY_NOT_FOUND')
  })

  it('rejects oversized JSON request bodies', async () => {
    const service = access()
    const result = createLocalAgentServer({ registry: registry(), access: service, maxBodyBytes: 64 })
    handle = result.handle
    await handle.listen(0)
    const token = service.ensureToken()

    const big = await requestJson(handle, 'POST', '/api/v1/invoke', { capability: 'echo', input: { value: 'x'.repeat(200) } }, token)
    expect(big.status).toBe(413)
  })

  it('rejects unsupported methods and non-versioned paths', async () => {
    const service = access()
    const result = createLocalAgentServer({ registry: registry(), access: service })
    handle = result.handle
    await handle.listen(0)
    const token = service.ensureToken()

    const put = await requestJson(handle, 'PUT', '/api/v1/health', undefined, token)
    expect(put.status).toBe(405)

    const weird = await requestJson(handle, 'GET', '/api/v1/other', undefined, token)
    expect(weird.status).toBe(404)
  })

  it('persists the selected port after binding', async () => {
    const service = access()
    const result = createLocalAgentServer({ registry: registry(), access: service })
    handle = result.handle
    await handle.listen(0)
    expect(handle.getSelectedPort()).toBe(portOf(handle))
  })
})
