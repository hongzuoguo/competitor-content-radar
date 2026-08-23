import type { z } from 'zod'

export const AGENT_API_VERSION = 'v1' as const

export type AgentApiVersion = typeof AGENT_API_VERSION
export type AgentInvocationSource = 'local-api' | 'mcp'
export type AgentRiskLevel = 'read' | 'write' | 'dangerous'
export type AgentPermission =
  | 'app.read'
  | 'data.read'
  | 'data.write'
  | 'settings.read'
  | 'settings.write'
  | 'data.delete'
  | 'security.write'

export interface AgentInvocationContext {
  source: AgentInvocationSource
  requestId?: string
  confirmationToken?: string
}

export interface AgentCapabilityDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  permission: AgentPermission
  risk: AgentRiskLevel
  minimumApiVersion: AgentApiVersion
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  deprecated?: boolean
  handler(input: TInput, context: AgentInvocationContext): Promise<TOutput> | TOutput
}

export interface AgentCapabilityDescription {
  name: string
  description: string
  permission: AgentPermission
  risk: AgentRiskLevel
  minimumApiVersion: AgentApiVersion
  deprecated: boolean
}

export interface AgentCapabilityManifest {
  appVersion: string
  apiVersion: AgentApiVersion
  capabilities: AgentCapabilityDescription[]
}

export class AgentCapabilityError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentCapabilityError'
  }
}
