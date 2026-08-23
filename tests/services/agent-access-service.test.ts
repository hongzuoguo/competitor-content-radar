import { describe, expect, it } from 'vitest'
import { AgentAccessService } from '../../src/services/agent/agent-access-service'

function harness() {
  const values = new Map<string, unknown>()
  const secrets = new Map<string, string>()
  const service = new AgentAccessService({
    settings: {
      get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
      set: (key: string, value: unknown) => { values.set(key, value) }
    },
    secrets: {
      get: (key: string) => secrets.get(key) ?? null,
      set: (key: string, value: string) => { secrets.set(key, value) },
      delete: (key: string) => { secrets.delete(key) }
    }
  }, { randomBytes: () => Buffer.alloc(32, 7), now: () => 1_000 })
  return { service, values, secrets }
}

describe('AgentAccessService', () => {
  it('creates, stores and authenticates an access token without public settings plaintext', () => {
    const { service, values, secrets } = harness()
    const token = service.ensureToken()
    expect(token).toBe(Buffer.alloc(32, 7).toString('base64url'))
    expect(secrets.get('agent.accessToken')).toBe(token)
    expect([...values.values()]).not.toContain(token)
    expect(service.authenticate(token)).toBe(true)
    expect(service.authenticate('wrong')).toBe(false)
  })

  it('persists enabled state and port', () => {
    const { service } = harness()
    service.setEnabled(false)
    service.setPort(32100)
    expect(service.getState()).toEqual({ enabled: false, port: 32100 })
  })

  it('issues one-use confirmations bound to capability and arguments', () => {
    const { service } = harness()
    const confirmation = service.issueConfirmation('creators.delete', { id: 'c1' })
    expect(service.consumeConfirmation(confirmation.token, 'creators.delete', { id: 'other' })).toBe(false)
    expect(service.consumeConfirmation(confirmation.token, 'creators.delete', { id: 'c1' })).toBe(true)
    expect(service.consumeConfirmation(confirmation.token, 'creators.delete', { id: 'c1' })).toBe(false)
  })
})
