import type { AgentAccessService } from './agent-access-service'
import { AgentAuditService } from './agent-audit-service'
import type { CapabilityRegistry } from './capability-registry'
import { createLocalAgentServer, type LocalAgentServerHandle } from './local-agent-server'
import { createMcpAdapter, type McpAdapterHandle } from './mcp-adapter'

export interface AgentLifecycleOptions {
  registry: CapabilityRegistry
  access: AgentAccessService
  audits: AgentAuditService
}

export interface AgentLifecycleState {
  running: boolean
  port: number | null
  error: string | null
}

/**
 * Owns the local Agent HTTP server and the MCP projection together so they
 * start and stop as one unit, and so the selected port survives restarts via
 * the access service settings.
 */
export class AgentLifecycle {
  private httpHandle: LocalAgentServerHandle | null = null
  private mcpHandle: McpAdapterHandle | null = null
  private currentPort: number | null = null
  private running = false
  private failure: string | null = null

  constructor(private readonly options: AgentLifecycleOptions) {}

  getState(): AgentLifecycleState {
    return {
      running: this.running,
      port: this.currentPort,
      error: this.failure
    }
  }

  /** Start both transports on the persisted port, or an ephemeral loopback port. */
  async start(): Promise<{ port: number }> {
    if (this.running) return { port: this.currentPort ?? 0 }
    const savedPort = this.options.access.getState().port
    const preferred = savedPort ?? 0
    try {
      const port = await this.bind(preferred)
      this.currentPort = port
      this.options.access.setPort(port)
      this.running = true
      this.failure = null
      return { port }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'AGENT_START_FAILED'
      this.running = false
      throw error
    }
  }

  private async bind(preferredPort: number): Promise<number> {
    const http = createLocalAgentServer({
      registry: this.options.registry,
      access: this.options.access
    })
    const mcp = createMcpAdapter({
      registry: this.options.registry,
      access: this.options.access,
      mountOn: http.handle.server
    })

    try {
      await http.handle.listen(preferredPort)
    } catch {
      // Preferred port busy or invalid: fall back to an ephemeral loopback port.
      await http.handle.listen(0)
    }
    const httpAddress = http.handle.server.address()
    if (!httpAddress || typeof httpAddress !== 'object') throw new Error('AGENT_PORT_UNAVAILABLE')
    const port = httpAddress.port

    try {
      await mcp.handle.start()
    } catch (error) {
      await http.handle.close()
      throw error
    }

    this.httpHandle = http.handle
    this.mcpHandle = mcp.handle
    return port
  }

  /** Stop both transports. Safe to call when already stopped. */
  async stop(): Promise<void> {
    if (this.mcpHandle) {
      await this.mcpHandle.close()
      this.mcpHandle = null
    }
    if (this.httpHandle) {
      await this.httpHandle.close()
      this.httpHandle = null
    }
    this.currentPort = null
    this.running = false
    this.failure = null
  }

  /** Restart after the token was regenerated or the enable state changed. */
  async restart(): Promise<{ port: number }> {
    await this.stop()
    return this.start()
  }
}
