import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityRegistry } from '../../src/services/agent/capability-registry'

describe('CapabilityRegistry', () => {
  it('discovers registered capabilities without exposing handlers', () => {
    const registry = new CapabilityRegistry({ appVersion: '0.3.1' })
    registry.register({
      name: 'works.get',
      description: 'Read one work.',
      permission: 'data.read',
      risk: 'read',
      minimumApiVersion: 'v1',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({ id: z.string() }),
      handler: async ({ id }) => ({ id })
    })

    expect(registry.describe()).toEqual({
      appVersion: '0.3.1',
      apiVersion: 'v1',
      capabilities: [{
        name: 'works.get',
        description: 'Read one work.',
        permission: 'data.read',
        risk: 'read',
        minimumApiVersion: 'v1',
        deprecated: false
      }]
    })
  })

  it('rejects duplicate names', () => {
    const registry = new CapabilityRegistry({ appVersion: '0.3.1' })
    const definition = {
      name: 'app.status',
      description: 'Status.',
      permission: 'app.read' as const,
      risk: 'read' as const,
      minimumApiVersion: 'v1' as const,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => ({ ok: true })
    }
    registry.register(definition)
    try {
      registry.register(definition)
      throw new Error('Expected duplicate registration to fail.')
    } catch (error) {
      expect(error).toMatchObject({ code: 'AGENT_CAPABILITY_DUPLICATE' })
    }
  })

  it('validates input and output around the handler', async () => {
    const handler = vi.fn(async ({ value }: { value: number }) => ({ doubled: value * 2 }))
    const registry = new CapabilityRegistry({ appVersion: '0.3.1' })
    registry.register({
      name: 'math.double',
      description: 'Double a number.',
      permission: 'app.read',
      risk: 'read',
      minimumApiVersion: 'v1',
      inputSchema: z.object({ value: z.number().int() }),
      outputSchema: z.object({ doubled: z.number().int() }),
      handler
    })

    await expect(registry.invoke('math.double', { value: '2' }, { source: 'local-api' }))
      .rejects.toMatchObject({ code: 'AGENT_INPUT_INVALID' })
    expect(handler).not.toHaveBeenCalled()

    await expect(registry.invoke('math.double', { value: 2 }, { source: 'local-api' }))
      .resolves.toEqual({ doubled: 4 })
  })

  it('returns stable sanitized errors instead of handler messages', async () => {
    const registry = new CapabilityRegistry({ appVersion: '0.3.1' })
    registry.register({
      name: 'secrets.fail',
      description: 'Fails.',
      permission: 'app.read',
      risk: 'read',
      minimumApiVersion: 'v1',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => { throw new Error('Bearer abc123 and full transcript') }
    })

    await expect(registry.invoke('secrets.fail', {}, { source: 'mcp' }))
      .rejects.toMatchObject({ code: 'AGENT_HANDLER_FAILED', message: 'Capability execution failed.' })
    await expect(registry.invoke('missing', {}, { source: 'mcp' }))
      .rejects.toMatchObject({ code: 'AGENT_CAPABILITY_NOT_FOUND' })
  })
})
