import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'
import { CapabilityRegistry } from '../../src/services/agent/capability-registry'
import { createMcpAdapter, type McpAdapterHandle } from '../../src/services/agent/mcp-adapter'
import { createLocalAgentServer } from '../../src/services/agent/local-agent-server'

function registry(): CapabilityRegistry {
  const reg = new CapabilityRegistry({ appVersion: '0.3.1' })
  reg.register({
    name: 'app.status',
    description: 'Read application status.',
    permission: 'app.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
    outputSchema: { safeParse: () => ({ success: true, data: { ready: true } }) } as never,
    handler: async () => ({ ready: true })
  })
  reg.register({
    name: 'works.get',
    description: 'Read one work.',
    permission: 'data.read',
    risk: 'read',
    minimumApiVersion: 'v1',
    inputSchema: { safeParse: () => ({ success: true, data: { id: 'w1' } }) } as never,
    outputSchema: { safeParse: () => ({ success: true, data: { id: 'w1', title: 'Work' } }) } as never,
    handler: async (input: unknown) => ({ ...(input as object), title: 'Work' })
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

describe('McpAdapter', () => {
  let handle: McpAdapterHandle | null = null

  afterEach(async () => {
    if (handle) await handle.close()
    handle = null
  })

  it('exposes every registry capability as an MCP tool once', async () => {
    const service = access()
    const result = createMcpAdapter({ registry: registry(), access: service })
    handle = result.handle
    await handle.start()

    const tools = await handle.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['app.status', 'works.get']))
    expect(new Set(names).size).toBe(names.length)
  })

  it('invokes the same registry handler from an MCP tool call', async () => {
    const service = access()
    const result = createMcpAdapter({ registry: registry(), access: service })
    handle = result.handle
    await handle.start()

    const output = await handle.callTool('works.get', { id: 'w1' })
    expect(output).toMatchObject({ id: 'w1', title: 'Work' })
  })

  it('returns a sanitized error for unknown tools', async () => {
    const service = access()
    const result = createMcpAdapter({ registry: registry(), access: service })
    handle = result.handle
    await handle.start()

    await expect(handle.callTool('nope', {})).rejects.toMatchObject({
      code: 'AGENT_CAPABILITY_NOT_FOUND'
    })
  })

  it('mounts Streamable HTTP at /mcp and rejects missing auth', async () => {
    const service = access()
    const result = createMcpAdapter({ registry: registry(), access: service })
    handle = result.handle
    await handle.start()
    await handle.listen(0)
    const address = handle.server.address() as AddressInfo

    const noAuth = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: 'POST' })
    expect(noAuth.status).toBe(401)

    const token = service.ensureToken()
    const initialize = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'codex-regression', version: '0.146.0' }
        }
      })
    })
    expect(initialize.status).toBe(200)
    expect(await initialize.text()).toContain('competitor-content-radar')
  })

  it('completes initialization when mounted on the shared local Agent server', async () => {
    const service = access()
    const local = createLocalAgentServer({ registry: registry(), access: service }).handle
    const mounted = createMcpAdapter({ registry: registry(), access: service, mountOn: local.server }).handle
    try {
      await local.listen(0)
      await mounted.start()
      const address = local.server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${service.ensureToken()}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'codex-regression', version: '0.146.0' }
          }
        })
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('competitor-content-radar')
    } finally {
      await mounted.close()
      await local.close()
    }
  })

  it('completes a mounted Streamable HTTP handshake and tool call', async () => {
    const service = access()
    const local = createLocalAgentServer({ registry: registry(), access: service }).handle
    const mounted = createMcpAdapter({ registry: registry(), access: service, mountOn: local.server }).handle
    let client: Client | null = null
    try {
      await local.listen(0)
      await mounted.start()
      const address = local.server.address() as AddressInfo
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp`),
        { requestInit: { headers: { authorization: `Bearer ${service.ensureToken()}` } } }
      )
      client = new Client({ name: 'codex-regression', version: '0.146.0' })

      await client.connect(transport)
      await expect(client.callTool({ name: 'works.get', arguments: { id: 'w1' } })).resolves.toMatchObject({
        content: expect.arrayContaining([expect.objectContaining({ type: 'text' })])
      })
    } finally {
      if (client) await client.close()
      await mounted.close()
      await local.close()
    }
  })

  it('supports a complete Streamable HTTP client handshake and tool listing', async () => {
    const service = access()
    const result = createMcpAdapter({ registry: registry(), access: service })
    handle = result.handle
    await handle.start()
    await handle.listen(0)
    const address = handle.server.address() as AddressInfo
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${service.ensureToken()}` } } }
    )
    const client = new Client({ name: 'codex-regression', version: '0.146.0' })
    try {
      await client.connect(transport)
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'works.get' })])
      })
    } finally {
      await client.close()
    }
  })
})
