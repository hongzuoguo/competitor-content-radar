import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { Socket } from 'node:net'
import type { AgentAccessService } from './agent-access-service'
import { AgentCapabilityError, AGENT_API_VERSION } from './agent-contract'
import type { CapabilityRegistry } from './capability-registry'

export interface LocalAgentServerOptions {
  registry: CapabilityRegistry
  access: AgentAccessService
  maxBodyBytes?: number
}

export interface LocalAgentServerHandle {
  server: Server
  listen(port: number): Promise<void>
  getSelectedPort(): number | null
  close(): Promise<void>
}

const DEFAULT_MAX_BODY_BYTES = 256 * 1024

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(payload))
}

function sanitizedError(error: unknown): { code: string, message: string } {
  if (error instanceof AgentCapabilityError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'AGENT_INTERNAL', message: 'Local agent request failed.' }
}

/**
 * Authenticated loopback-only HTTP server projecting the capability registry.
 * Binds exclusively to 127.0.0.1, never enables CORS, and rejects requests
 * from non-loopback remote addresses, unusual Host headers, unknown routes
 * and oversized bodies.
 */
export function createLocalAgentServer(options: LocalAgentServerOptions): { handle: LocalAgentServerHandle } {
  const { registry, access } = options
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  let selectedPort: number | null = null

  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/mcp') return
    void handleRequest(request, response).catch((error) => {
      writeJson(response, 500, { error: sanitizedError(error) })
    })
  })

  server.on('connection', (socket: Socket) => {
    const remote = socket.remoteAddress ?? ''
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    if (!isLoopback) {
      socket.destroy()
    }
  })

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host ?? ''
    const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      writeJson(response, 403, { error: { code: 'AGENT_HOST_REJECTED', message: 'Only loopback requests are accepted.' } })
      return
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/v1/')) {
      writeJson(response, 404, { error: { code: 'AGENT_NOT_FOUND', message: 'Route not found.' } })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      writeJson(response, 200, { ok: true, apiVersion: AGENT_API_VERSION, appVersion: registry.describe().appVersion })
      return
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'AGENT_METHOD_NOT_ALLOWED', message: 'Method not allowed.' } })
      return
    }

    if (!authenticate(request)) {
      writeJson(response, 401, { error: { code: 'AGENT_UNAUTHORIZED', message: 'A valid bearer token is required.' } })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
      writeJson(response, 200, registry.describe())
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/invoke') {
      const body = await readBody(request, maxBodyBytes)
      if (body === null) {
        writeJson(response, 413, { error: { code: 'AGENT_PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        writeJson(response, 400, { error: { code: 'AGENT_BAD_JSON', message: 'Request body is not valid JSON.' } })
        return
      }
      const envelope = parsed as { capability?: unknown, input?: unknown }
      if (typeof envelope?.capability !== 'string') {
        writeJson(response, 400, { error: { code: 'AGENT_BAD_INPUT', message: 'Missing capability name.' } })
        return
      }
      try {
        const result = await registry.invoke(envelope.capability, envelope.input ?? {}, { source: 'local-api' })
        writeJson(response, 200, { ok: true, result })
      } catch (error) {
        const sanitized = sanitizedError(error)
        const status = sanitized.code === 'AGENT_CAPABILITY_NOT_FOUND' ? 404 : 400
        writeJson(response, status, { error: sanitized })
      }
      return
    }

    writeJson(response, 404, { error: { code: 'AGENT_NOT_FOUND', message: 'Route not found.' } })
  }

  function authenticate(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match) return false
    return access.authenticate(match[1])
  }

  return {
    handle: {
      server,
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
        const address = server.address()
        if (address && typeof address === 'object') {
          selectedPort = address.port
        }
      },
      getSelectedPort(): number | null {
        return selectedPort
      },
      async close(): Promise<void> {
        if (!server.listening) return
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  }
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) return null
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
