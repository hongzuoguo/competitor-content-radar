import type { AgentAccessService } from './agent-access-service'
import { AgentLifecycle } from './agent-lifecycle'

export interface AgentManagerOptions {
  access: AgentAccessService
  lifecycle: AgentLifecycle
}

export interface AgentManagerStatus {
  enabled: boolean
  running: boolean
  port: number | null
  address: string | null
  apiVersion: string
  error: string | null
}

/** High-level Agent service facade for IPC and the settings page. */
export class AgentManager {
  constructor(private readonly options: AgentManagerOptions) {}

  getStatus(): AgentManagerStatus {
    const state = this.options.access.getState()
    const lifecycle = this.options.lifecycle.getState()
    return {
      enabled: state.enabled,
      running: lifecycle.running,
      port: lifecycle.port,
      address: state.enabled && lifecycle.running ? `http://127.0.0.1:${lifecycle.port ?? 0}` : null,
      apiVersion: 'v1',
      error: lifecycle.error
    }
  }

}
