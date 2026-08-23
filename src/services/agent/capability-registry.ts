import {
  AGENT_API_VERSION,
  AgentCapabilityError,
  type AgentCapabilityDefinition,
  type AgentCapabilityManifest,
  type AgentInvocationContext
} from './agent-contract'

export class CapabilityRegistry {
  private readonly definitions = new Map<string, AgentCapabilityDefinition>()

  constructor(private readonly options: { appVersion: string }) {}

  register<TInput, TOutput>(definition: AgentCapabilityDefinition<TInput, TOutput>): void {
    const name = definition.name.trim()
    if (!name || this.definitions.has(name)) {
      throw new AgentCapabilityError('AGENT_CAPABILITY_DUPLICATE', 'Capability name is already registered.')
    }
    this.definitions.set(name, definition as AgentCapabilityDefinition)
  }

  describe(): AgentCapabilityManifest {
    return {
      appVersion: this.options.appVersion,
      apiVersion: AGENT_API_VERSION,
      capabilities: [...this.definitions.values()].map((definition) => ({
        name: definition.name,
        description: definition.description,
        permission: definition.permission,
        risk: definition.risk,
        minimumApiVersion: definition.minimumApiVersion,
        deprecated: definition.deprecated ?? false
      }))
    }
  }

  get(name: string): AgentCapabilityDefinition | null {
    return this.definitions.get(name) ?? null
  }

  async invoke(name: string, input: unknown, context: AgentInvocationContext): Promise<unknown> {
    const definition = this.definitions.get(name)
    if (!definition) {
      throw new AgentCapabilityError('AGENT_CAPABILITY_NOT_FOUND', 'Capability was not found.')
    }

    const parsedInput = definition.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      throw new AgentCapabilityError('AGENT_INPUT_INVALID', 'Capability input is invalid.')
    }

    let output: unknown
    try {
      output = await definition.handler(parsedInput.data, context)
    } catch (error) {
      if (error instanceof AgentCapabilityError) throw error
      throw new AgentCapabilityError('AGENT_HANDLER_FAILED', 'Capability execution failed.')
    }

    const parsedOutput = definition.outputSchema.safeParse(output)
    if (!parsedOutput.success) {
      throw new AgentCapabilityError('AGENT_OUTPUT_INVALID', 'Capability returned an invalid result.')
    }
    return parsedOutput.data
  }
}
