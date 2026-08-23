import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z, type ZodType } from 'zod'
import type { AgentAccessService } from './agent-access-service'
import { AgentCapabilityError } from './agent-contract'
import type { CapabilityRegistry } from './capability-registry'
import type { AgentCapabilityDescription } from './agent-contract'

export interface McpAdapterOptions {
  registry: CapabilityRegistry
  access: AgentAccessService
  /** When provided, the MCP handler mounts on this server's /mcp route instead of creating its own server. */
  mountOn?: Server
}

export interface McpAdapterHandle {
  server: Server
  start(): Promise<void>
  listen(port: number): Promise<void>
  listTools(): Promise<Array<{ name: string, description?: string }>>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

function zodToMcpSchema(inputSchema: ZodType): Record<string, unknown> {
  // Registry input schemas are Zod objects; project each field shape into a
  // JSON Schema object acceptable to the MCP SDK without hand-writing a
  // second capability definition.
  const shape = (inputSchema as unknown as { shape?: Record<string, ZodType> }).shape
  if (!shape) return { type: 'object', properties: {} }
  const properties: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(shape)) {
    properties[key] = describeZod(field)
  }
  return { type: 'object', properties }
}

function describeZod(field: ZodType): unknown {
  const typeName = (field as unknown as { _def?: { typeName?: string } })._def?.typeName ?? ''
  if (typeName.includes('ZodString')) return { type: 'string' }
  if (typeName.includes('ZodBoolean')) return { type: 'boolean' }
  if (typeName.includes('ZodNumber')) return { type: 'number' }
  if (typeName.includes('ZodArray')) return { type: 'array' }
  if (typeName.includes('ZodObject')) return zodToMcpSchema(field)
  if (typeName.includes('ZodOptional')) {
    const inner = (field as unknown as { _def?: { innerType?: ZodType } })._def?.innerType
    return inner ? describeZod(inner) : {}
  }
  return {}
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(payload))
}

function sanitizedError(error: unknown): { code: string, message: string } {
  if (error instanceof AgentCapabilityError) return { code: error.code, message: error.message }
  return { code: 'AGENT_INTERNAL', message: 'Local agent request failed.' }
}

/**
 * Projects the same capability registry onto the MCP protocol. Tools are
 * generated from registry definitions (never a second hand-written list),
 * share the same bearer token and audit context as the local HTTP API,
 * and are served over Streamable HTTP at /mcp.
 */
export function createMcpAdapter(options: McpAdapterOptions): { handle: McpAdapterHandle } {
  const { registry, access } = options
  const capabilities = registry.describe().capabilities
  const toolDefinitions = new Map<string, { description: string, inputSchema: ZodType }>()
  const byName = new Map<string, { definition: { inputSchema: ZodType }, description: string }>()

  for (const capability of capabilities as AgentCapabilityDescription[]) {
    const definition = registry.get(capability.name)
    if (!definition) continue
    toolDefinitions.set(capability.name, {
      description: capability.description,
      inputSchema: definition.inputSchema as ZodType
    })
    byName.set(capability.name, {
      definition: definition as unknown as { inputSchema: ZodType },
      description: capability.description
    })
  }

  const server = options.mountOn ?? createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      writeJson(response, 500, { error: sanitizedError(error) })
    })
  })

  if (options.mountOn) {
    options.mountOn.on('request', (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (pathname !== '/mcp') return
      void handleRequest(request, response).catch((error) => {
        writeJson(response, 500, { error: sanitizedError(error) })
      })
    })
  }

  const activeRequests = new Set<{
    mcp: McpServer
    transport: StreamableHTTPServerTransport
  }>()

  function createRequestServer(): McpServer {
    const mcp = new McpServer({ name: 'competitor-content-radar', version: registry.describe().appVersion })
    for (const [name, tool] of toolDefinitions) {
      mcp.registerTool(name, {
        title: name,
        description: tool.description,
        inputSchema: (tool.inputSchema as unknown as { shape: Record<string, ZodType> }).shape
      }, async (args) => {
        const result = await registry.invoke(name, args ?? {}, { source: 'mcp' })
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      })
    }
    return mcp
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host ?? ''
    const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      writeJson(response, 403, { error: { code: 'AGENT_HOST_REJECTED', message: 'Only loopback requests are accepted.' } })
      return
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') {
      writeJson(response, 404, { error: { code: 'AGENT_NOT_FOUND', message: 'Route not found.' } })
      return
    }

    const header = request.headers.authorization ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match || !access.authenticate(match[1])) {
      writeJson(response, 401, { error: { code: 'AGENT_UNAUTHORIZED', message: 'A valid bearer token is required.' } })
      return
    }

    // Stateless Streamable HTTP requires a fresh protocol server together
    // with each fresh transport. Reusing a connected McpServer makes the
    // initialized notification (the second HTTP request) fail with HTTP 500.
    const mcp = createRequestServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      onsessioninitialized: () => { /* stateless transport has no session id */ }
    })
    const active = { mcp, transport }
    activeRequests.add(active)
    let closed = false
    let requestHandled = false
    let responseClosed = false
    const closeRequest = async (): Promise<void> => {
      if (closed) return
      closed = true
      activeRequests.delete(active)
      await Promise.allSettled([transport.close(), mcp.close()])
    }
    response.once('close', () => {
      responseClosed = true
      if (requestHandled) void closeRequest()
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(request, response)
      requestHandled = true
      if (responseClosed) await closeRequest()
    } catch (error) {
      await closeRequest()
      throw error
    }
  }

  return {
    handle: {
      server,
      async start(): Promise<void> {
        // MCP server is ready; tools registered in constructor.
      },
      async listen(port: number): Promise<void> {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => {
            server.off('listening', onListening)
            reject(error)
          }
          const onListening = (): void => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
      },
      async listTools(): Promise<Array<{ name: string, description?: string }>> {
        return [...toolDefinitions.entries()].map(([name, tool]) => ({ name, description: tool.description }))
      },
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return registry.invoke(name, args ?? {}, { source: 'mcp' })
      },
      async close(): Promise<void> {
        await Promise.all([...activeRequests].map(async (active) => {
          activeRequests.delete(active)
          await Promise.allSettled([active.transport.close(), active.mcp.close()])
        }))
        if (!options.mountOn && server.listening) {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
      }
    }
  }
}
