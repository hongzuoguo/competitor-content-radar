import { beforeEach, describe, expect, it, vi } from 'vitest'

const { safeStorage } = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    decryptString: vi.fn()
  }
}))

vi.mock('electron', () => ({ safeStorage }))

import { SecretStore } from '../../src/services/secrets/secret-store'

class MemorySettings {
  private readonly values = new Map<string, unknown>()

  set(key: string, value: unknown): void { this.values.set(key, value) }
  get<T>(key: string): T | null { return (this.values.get(key) as T | undefined) ?? null }
  delete(key: string): void { this.values.delete(key) }
}

describe('SecretStore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks stored secret presence without touching secure storage', () => {
    const settings = new MemorySettings()
    const secrets = new SecretStore(settings)

    expect(secrets.has('ai.profile.one')).toBe(false)
    settings.set('secret.ai.profile.one', 'encrypted-value')
    expect(secrets.has('ai.profile.one')).toBe(true)
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
  })
})
