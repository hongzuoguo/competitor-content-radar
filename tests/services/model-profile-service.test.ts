import { describe, expect, it, vi } from 'vitest'
import { ModelProfileService } from '../../src/services/ai/model-profile-service'
import type { ModelProfileRecord } from '../../src/services/database/repositories'

class MemoryProfiles {
  private readonly values = new Map<string, ModelProfileRecord>()
  failNextSave = false
  failNextDelete = false
  onNextSaveFailure: (() => void) | undefined
  onNextDeleteFailure: (() => void) | undefined

  save(profile: ModelProfileRecord): void {
    if (this.failNextSave) {
      this.failNextSave = false
      this.onNextSaveFailure?.()
      this.onNextSaveFailure = undefined
      throw new Error('PROFILE_SAVE_FAILED')
    }
    if (profile.active && !profile.enabled) throw new Error('MODEL_PROFILE_DISABLED')
    if (profile.active) {
      for (const value of this.values.values()) value.active = false
    }
    this.values.set(profile.id, { ...profile })
  }

  get(id: string): ModelProfileRecord | null {
    const value = this.values.get(id)
    return value ? { ...value } : null
  }

  list(): ModelProfileRecord[] {
    return [...this.values.values()].map((value) => ({ ...value }))
  }

  getActive(): ModelProfileRecord | null {
    return this.list().find((value) => value.active) ?? null
  }

  activate(id: string): void {
    const profile = this.values.get(id)
    if (!profile) throw new Error('MODEL_PROFILE_NOT_FOUND')
    if (!profile.enabled) throw new Error('MODEL_PROFILE_DISABLED')
    for (const value of this.values.values()) value.active = false
    profile.active = true
  }

  delete(id: string): void {
    if (this.failNextDelete) {
      this.failNextDelete = false
      this.onNextDeleteFailure?.()
      this.onNextDeleteFailure = undefined
      throw new Error('PROFILE_DELETE_FAILED')
    }
    this.values.delete(id)
  }
}

class MemorySettings {
  private readonly values = new Map<string, unknown>()
  failNextSet = false

  set(key: string, value: unknown): void {
    if (this.failNextSet) {
      this.failNextSet = false
      throw new Error('CREDENTIAL_REVISION_SAVE_FAILED')
    }
    this.values.set(key, value)
  }
  get<T>(key: string): T | null { return (this.values.get(key) as T | undefined) ?? null }
  delete(key: string): void { this.values.delete(key) }
}

class MemorySecrets {
  private readonly values = new Map<string, string>()
  failNextSet = false
  failNextDelete = false
  throwOnGet = false

  set(key: string, value: string): void {
    if (this.failNextSet) {
      this.failNextSet = false
      throw new Error('SECRET_SET_FAILED')
    }
    this.values.set(key, value)
  }

  get(key: string): string | null {
    if (this.throwOnGet) throw new Error('SECRET_DECRYPT_FAILED')
    return this.values.get(key) ?? null
  }

  has(key: string): boolean { return this.values.has(key) }

  delete(key: string): void {
    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error('SECRET_DELETE_FAILED')
    }
    this.values.delete(key)
  }
}

const input = (overrides = {}) => ({
  name: ' DeepSeek Chat ',
  providerTemplate: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  modelId: ' deepseek-chat ',
  requiresApiKey: true,
  enabled: true,
  ...overrides
})

function createService(
  connectionTester?: (profile: { apiKey: string | null }) => Promise<{ executed: boolean, ok: boolean }>,
  connectionLogger?: (entry: { profileId: string, errorCode: string | null, durationMs: number }) => void,
  onChanged?: () => void,
  now: () => string = () => '2026-08-01T00:00:00.000Z'
) {
  const profiles = new MemoryProfiles()
  const settings = new MemorySettings()
  const secrets = new MemorySecrets()
  let id = 0
  const service = new ModelProfileService({ profiles, settings, secrets, connectionTester, connectionLogger, onChanged }, {
    createId: () => `profile-${++id}`,
    now
  })
  return { service, profiles, settings, secrets }
}

describe('ModelProfileService', () => {
  it('creates, updates, activates, and deletes profiles with independent key lifecycle', () => {
    const { service, secrets } = createService()

    const first = service.create(input(), ' top-secret ')
    const second = service.create(input({ name: 'Second' }))

    expect(first).toMatchObject({ id: 'profile-1', name: 'DeepSeek Chat', modelId: 'deepseek-chat', active: true, apiKeyConfigured: true })
    expect(second.active).toBe(false)
    expect(service.update(first.id, input({ name: 'Renamed' }))).toMatchObject({ name: 'Renamed', active: true })
    service.setActive(second.id)
    expect(service.get(second.id).active).toBe(true)
    service.setApiKey(second.id, ' second-key ')
    expect(secrets.get('ai.profile.profile-2')).toBe('second-key')
    service.deleteApiKey(second.id)
    expect(service.get(second.id).apiKeyConfigured).toBe(false)
    service.delete(first.id)
    expect(secrets.get('ai.profile.profile-1')).toBeNull()
    expect(() => service.get(first.id)).toThrow('MODEL_PROFILE_NOT_FOUND')
  })

  it('never exposes API key material in public views', () => {
    const { service } = createService()
    const view = service.create(input(), 'top-secret')

    expect(JSON.stringify(view)).not.toContain('top-secret')
    expect(view).toMatchObject({ apiKeyConfigured: true })
    expect(view).not.toHaveProperty('apiKey')
  })

  it('uses a separate monotonic credential revision in active health identity', () => {
    const { service } = createService()
    const profile = service.create(input(), 'first-secret')

    expect(service.getActiveHealthIdentity()).toEqual(expect.objectContaining({
      id: profile.id,
      providerTemplate: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
      updatedAt: '2026-08-01T00:00:00.000Z',
      credentialRevision: 1
    }))
    expect(JSON.stringify(service.getActiveHealthIdentity())).not.toContain('first-secret')

    service.setApiKey(profile.id, 'second-secret')
    expect(service.getActiveHealthIdentity()).toMatchObject({ credentialRevision: 2 })
    service.deleteApiKey(profile.id)
    expect(service.getActiveHealthIdentity()).toMatchObject({ credentialRevision: 3 })
  })

  it('rolls back secret and profile writes when credential revision persistence fails', () => {
    const { service, profiles, settings, secrets } = createService()
    settings.failNextSet = true
    expect(() => service.create(input(), 'create-secret')).toThrow('CREDENTIAL_REVISION_SAVE_FAILED')
    expect(profiles.list()).toEqual([])
    expect(secrets.get('ai.profile.profile-1')).toBeNull()

    const profile = service.create(input(), 'old-secret')
    settings.failNextSet = true
    expect(() => service.update(profile.id, input({ name: 'Changed' }), 'new-secret')).toThrow('CREDENTIAL_REVISION_SAVE_FAILED')
    expect(service.get(profile.id)).toMatchObject({ name: 'DeepSeek Chat' })
    expect(secrets.get(`ai.profile.${profile.id}`)).toBe('old-secret')

    settings.failNextSet = true
    expect(() => service.setApiKey(profile.id, 'third-secret')).toThrow('CREDENTIAL_REVISION_SAVE_FAILED')
    expect(secrets.get(`ai.profile.${profile.id}`)).toBe('old-secret')

    settings.failNextSet = true
    expect(() => service.deleteApiKey(profile.id)).toThrow('CREDENTIAL_REVISION_SAVE_FAILED')
    expect(secrets.get(`ai.profile.${profile.id}`)).toBe('old-secret')
  })

  it('increments credential revision when updating a profile removes its key', () => {
    const { service } = createService()
    const profile = service.create(input(), 'top-secret')

    service.update(profile.id, input({ requiresApiKey: false }))

    expect(service.getActiveHealthIdentity()).toMatchObject({ credentialRevision: 2 })
  })

  it('notifies once after each successful profile or credential mutation', () => {
    const onChanged = vi.fn()
    const { service } = createService(undefined, undefined, onChanged)
    const first = service.create(input(), 'first-secret')
    const second = service.create(input({ name: 'Second' }))

    service.update(first.id, input({ name: 'Updated' }))
    service.setActive(second.id)
    service.setApiKey(second.id, 'second-secret')
    service.deleteApiKey(second.id)
    service.delete(second.id)

    expect(onChanged).toHaveBeenCalledTimes(7)
  })

  it('preserves the complete health identity and skips mutation notification for a true no-op update', () => {
    const onChanged = vi.fn()
    let timestamp = '2026-08-01T00:00:00.000Z'
    const { service } = createService(undefined, undefined, onChanged, () => timestamp)
    const profile = service.create(input(), 'stored-secret')
    const before = service.getActiveHealthIdentity()
    onChanged.mockClear()
    timestamp = '2026-08-02T00:00:00.000Z'

    const saved = service.update(profile.id, input())

    expect(saved.updatedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(service.getActiveHealthIdentity()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('does not turn an already committed profile mutation into a failure when its notification throws', () => {
    const onChanged = vi.fn(() => { throw new Error('ENGINE_HEALTH_INVALIDATION_FAILED') })
    const { service } = createService(undefined, undefined, onChanged)

    expect(() => service.create(input(), 'top-secret')).not.toThrow()
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('rejects disabling the active profile and refuses to activate disabled profiles', () => {
    const { service } = createService()
    const active = service.create(input())
    const disabled = service.create(input({ name: 'Disabled', enabled: false }))

    expect(() => service.update(active.id, input({ enabled: false }))).toThrow('MODEL_PROFILE_ACTIVE_DISABLE_FORBIDDEN')
    expect(() => service.setActive(disabled.id)).toThrow('MODEL_PROFILE_DISABLED')
  })

  it('returns the active profile with its key only for runtime use', () => {
    const { service } = createService()
    service.create(input(), 'runtime-secret')

    expect(service.getActiveRuntimeProfile()).toMatchObject({
      apiKey: 'runtime-secret',
      compatibility: 'openai-compatible',
      modelId: 'deepseek-chat'
    })
    expect(service.getActiveRuntimeProfile()).not.toBeNull()
  })

  it('migrates one legacy profile idempotently and copies its existing key', () => {
    const { service, profiles, settings, secrets } = createService()
    settings.set('app.publicSettings', {
      providerId: 'deepseek', modelId: 'deepseek-chat', customBaseUrl: ' https://legacy.example/v1 '
    })
    secrets.set('ai.deepseek', 'legacy-secret')

    const first = service.migrateLegacyProfile()
    const second = service.migrateLegacyProfile()

    expect(first?.id).toBe(second?.id)
    expect(profiles.list()).toHaveLength(1)
    expect(secrets.get(`ai.profile.${first?.id}`)).toBe('legacy-secret')
    expect(settings.get('migration.modelProfiles.v1')).toMatchObject({ profileId: first?.id })
  })

  it('marks absent legacy settings and does not recreate a deleted migrated profile', () => {
    const { service, settings } = createService()

    expect(service.migrateLegacyProfile()).toBeNull()
    expect(settings.get('migration.modelProfiles.v1')).toBeTruthy()

    const another = createService()
    another.settings.set('app.publicSettings', { providerId: 'deepseek', modelId: 'deepseek-chat' })
    const migrated = another.service.migrateLegacyProfile()
    another.service.delete(migrated!.id)
    expect(another.service.migrateLegacyProfile()).toBeNull()
  })

  it.each([
    ['providerId', 123],
    ['modelId', { value: 'deepseek-chat' }],
    ['customBaseUrl', 456]
  ] as const)('safely skips malformed legacy %s values', (field, malformedValue) => {
    const { service, settings } = createService()
    settings.set('app.publicSettings', {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      customBaseUrl: 'https://legacy.example/v1',
      [field]: malformedValue
    })

    expect(service.migrateLegacyProfile()).toBeNull()
    expect(settings.get('migration.modelProfiles.v1')).toEqual({ profileId: null })
    expect(service.migrateLegacyProfile()).toBeNull()
  })

  it('does not create or update profiles when writing a replacement key fails', () => {
    const { service, profiles, secrets } = createService()
    secrets.failNextSet = true
    expect(() => service.create(input(), 'new-secret')).toThrow('SECRET_SET_FAILED')
    expect(profiles.list()).toHaveLength(0)

    const profile = service.create(input(), 'old-secret')
    secrets.failNextSet = true
    expect(() => service.update(profile.id, input({ name: 'Changed' }), 'new-secret')).toThrow('SECRET_SET_FAILED')
    expect(service.get(profile.id).name).toBe('DeepSeek Chat')
    expect(secrets.get(`ai.profile.${profile.id}`)).toBe('old-secret')
  })

  it('keeps a profile when deleting its key fails and restores its key when profile deletion fails', () => {
    const { service, profiles, secrets } = createService()
    const profile = service.create(input(), 'old-secret')

    secrets.failNextDelete = true
    expect(() => service.delete(profile.id)).toThrow('SECRET_DELETE_FAILED')
    expect(service.get(profile.id).id).toBe(profile.id)

    profiles.failNextDelete = true
    expect(() => service.delete(profile.id)).toThrow('PROFILE_DELETE_FAILED')
    expect(secrets.get(`ai.profile.${profile.id}`)).toBe('old-secret')
  })

  it('uses secret presence rather than decryption for public views', () => {
    const { service, secrets } = createService()
    const profile = service.create(input(), 'configured-secret')
    secrets.throwOnGet = true

    expect(service.get(profile.id)).toMatchObject({ apiKeyConfigured: true })
    expect(service.list()).toHaveLength(1)
  })

  it('never stores or reads keys for keyless profiles and removes a key when switching to keyless', () => {
    const { service, secrets } = createService()
    const keyless = service.create(input({ requiresApiKey: false }), 'ignored-secret')
    expect(secrets.has(`ai.profile.${keyless.id}`)).toBe(false)
    expect(() => service.setApiKey(keyless.id, 'forbidden')).toThrow('MODEL_PROFILE_API_KEY_NOT_REQUIRED')
    secrets.throwOnGet = true
    expect(service.get(keyless.id)).toMatchObject({ apiKeyConfigured: false })

    secrets.throwOnGet = false
    const keyed = service.create(input({ name: 'Keyed' }), 'old-secret')
    expect(service.update(keyed.id, input({ name: 'Keyless now', requiresApiKey: false }))).toMatchObject({ apiKeyConfigured: false })
    expect(secrets.has(`ai.profile.${keyed.id}`)).toBe(false)
    expect(service.update(keyed.id, input({ name: 'Keyed again', requiresApiKey: true }))).toMatchObject({ apiKeyConfigured: false })
  })

  it('does not switch a profile to keyless when removing its old key fails', () => {
    const { service, secrets } = createService()
    const profile = service.create(input(), 'old-secret')
    secrets.failNextDelete = true

    expect(() => service.update(profile.id, input({ requiresApiKey: false }))).toThrow('SECRET_DELETE_FAILED')
    expect(service.get(profile.id)).toMatchObject({ requiresApiKey: true, apiKeyConfigured: true })
  })

  it.each([
    ['create', 'PROFILE_SAVE_FAILED', 'SECRET_DELETE_FAILED', (service: ModelProfileService, profiles: MemoryProfiles, secrets: MemorySecrets) => {
      profiles.failNextSave = true
      secrets.failNextDelete = true
      return () => service.create(input(), 'new-secret')
    }],
    ['update', 'PROFILE_SAVE_FAILED', 'SECRET_SET_FAILED', (service: ModelProfileService, profiles: MemoryProfiles, secrets: MemorySecrets) => {
      const profile = service.create(input(), 'old-secret')
      profiles.failNextSave = true
      profiles.onNextSaveFailure = () => { secrets.failNextSet = true }
      return () => service.update(profile.id, input({ name: 'Changed' }), 'new-secret')
    }],
    ['delete', 'PROFILE_DELETE_FAILED', 'SECRET_SET_FAILED', (service: ModelProfileService, profiles: MemoryProfiles, secrets: MemorySecrets) => {
      const profile = service.create(input(), 'old-secret')
      profiles.failNextDelete = true
      profiles.onNextDeleteFailure = () => { secrets.failNextSet = true }
      return () => service.delete(profile.id)
    }]
  ] as const)('surfaces rollback failure after a failed %s operation', (_operation, originalError, rollbackError, arrange) => {
    const { service, profiles, secrets } = createService()
    const operation = arrange(service, profiles, secrets)

    let caught: unknown
    try {
      operation()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).message).toBe('MODEL_PROFILE_SECRET_ROLLBACK_FAILED')
    expect((caught as AggregateError).errors).toEqual([
      expect.objectContaining({ message: originalError }),
      expect.objectContaining({ message: rollbackError })
    ])
  })

  it('only reads stored keys when testing a saved profile that requires one', async () => {
    const tester = vi.fn().mockResolvedValue({ executed: true, ok: true })
    const { service, secrets } = createService(tester)
    const keyed = service.create(input(), 'stored-secret')
    secrets.throwOnGet = true

    await expect(service.testConnection(input({ requiresApiKey: false }), undefined, keyed.id)).resolves.toEqual({ executed: true, ok: true })
    expect(tester).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }))

    await expect(service.testConnection(input({ requiresApiKey: false }))).resolves.toEqual({ executed: true, ok: true })
    expect(tester).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }))

    secrets.throwOnGet = false
    await service.testConnection(input(), undefined, keyed.id)
    expect(tester).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'stored-secret' }))
  })

  it('tests the active profile through the established connection tester exactly once', async () => {
    const tester = vi.fn().mockResolvedValue({ executed: true, ok: true })
    const { service } = createService(tester)
    const active = service.create(input(), 'active-secret')
    service.create(input({ name: 'Inactive' }), 'inactive-secret')

    await expect(service.testActiveConnection()).resolves.toEqual({ executed: true, ok: true })
    expect(tester).toHaveBeenCalledTimes(1)
    expect(tester).toHaveBeenCalledWith(expect.objectContaining({ id: active.id, apiKey: 'active-secret' }))
  })

  it('reports a missing active profile without issuing a connection test', async () => {
    const tester = vi.fn().mockResolvedValue({ executed: true, ok: true })
    const { service } = createService(tester)

    await expect(service.testActiveConnection()).resolves.toEqual({
      executed: false, ok: false, errorCode: 'CLOUD_PROFILE_MISSING'
    })
    expect(tester).not.toHaveBeenCalled()
  })

  it.each([
    ['AI_HTTP_401', 'INVALID_API_KEY'],
    ['AI_HTTP_403', 'INVALID_API_KEY'],
    ['AI_HTTP_404', 'MODEL_NOT_FOUND'],
    ['AI_EMPTY_RESPONSE', 'EMPTY_RESPONSE'],
    ['Unexpected token < in JSON', 'INCOMPATIBLE_RESPONSE'],
    ['request timed out', 'CONNECTION_TIMEOUT'],
    ['network unavailable', 'CONNECTION_FAILED']
  ])('maps connection failures without exposing credentials: %s', async (failure, errorCode) => {
    const tester = vi.fn().mockRejectedValue(new Error(failure))
    const { service } = createService(tester)

    await expect(service.testConnection(input(), 'draft-secret')).resolves.toMatchObject({
      executed: true,
      ok: false,
      errorCode
    })
  })

  it('logs only profile id, result code, and duration for a connection test', async () => {
    const logger = vi.fn()
    const tester = vi.fn().mockResolvedValue({ executed: true, ok: true })
    const { service } = createService(tester, logger)

    await service.testConnection(input(), 'draft-secret')

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'draft',
      errorCode: null,
      durationMs: expect.any(Number)
    }))
    expect(JSON.stringify(logger.mock.calls)).not.toContain('draft-secret')
  })
})
