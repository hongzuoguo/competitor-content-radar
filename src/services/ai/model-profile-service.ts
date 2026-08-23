import { randomUUID } from 'node:crypto'
import { ModelProfileInputSchema, type ModelProfileInput, type ProviderTemplate } from './model-profile'
import { AI_PROVIDER_CATALOG } from './provider-catalog'
import type { ModelProfileRecord, ModelProfileRepository, SettingsRepository } from '../database/repositories'

const LEGACY_SETTINGS_KEY = 'app.publicSettings'
const LEGACY_MIGRATION_KEY = 'migration.modelProfiles.v1'
const LEGACY_PROFILE_ID = 'legacy-model-profile-v1'
const CREDENTIAL_REVISION_PREFIX = 'modelProfiles.credentialRevision.'

type ProfileRepository = Pick<ModelProfileRepository, 'save' | 'get' | 'list' | 'getActive' | 'activate' | 'delete'>
type SettingsStore = Pick<SettingsRepository, 'get' | 'set' | 'delete'>

interface SecretStoreLike {
  get(key: string): string | null
  has(key: string): boolean
  set(key: string, value: string): void
  delete(key: string): void
}

type SecretChange = { type: 'set', value: string } | { type: 'delete' }
type SecretSnapshot = { exists: false } | { exists: true, value: string }

export interface ModelProfileView {
  id: string
  name: string
  providerTemplate: ProviderTemplate
  baseUrl: string
  modelId: string
  requiresApiKey: boolean
  enabled: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  apiKeyConfigured: boolean
}

export interface RuntimeModelProfile {
  id: string
  name: string
  providerTemplate: ProviderTemplate
  baseUrl: string
  modelId: string
  requiresApiKey: boolean
  compatibility: 'openai-compatible'
  apiKey: string | null
}

export interface ActiveModelHealthIdentity {
  id: string
  providerTemplate: ProviderTemplate
  baseUrl: string
  modelId: string
  updatedAt: string
  /** A non-secret monotonically increasing version, never key material. */
  credentialRevision: number
}

export interface ConnectionTestResult {
  executed: boolean
  ok: boolean
  errorCode?: string
  message?: string
}

export interface ModelProfileServiceDependencies {
  profiles: ProfileRepository
  settings: SettingsStore
  secrets: SecretStoreLike
  connectionTester?: (profile: RuntimeModelProfile) => Promise<ConnectionTestResult>
  connectionLogger?: (entry: { profileId: string, errorCode: string | null, durationMs: number }) => void
  /** Best-effort observer called only after a profile/key mutation commits. */
  onChanged?: () => void
}

export interface ModelProfileServiceOptions {
  now?: () => string
  createId?: () => string
}

interface LegacySettings {
  providerId?: unknown
  modelId?: unknown
  customBaseUrl?: unknown
}

interface LegacyMigrationMarker {
  profileId: string | null
}

function readOptionalTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value.trim() : null
}

export class ModelProfileService {
  private readonly now: () => string
  private readonly createId: () => string

  constructor(
    private readonly dependencies: ModelProfileServiceDependencies,
    options: ModelProfileServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? randomUUID
  }

  list(): ModelProfileView[] {
    return this.dependencies.profiles.list().map((profile) => this.toView(profile))
  }

  get(id: string): ModelProfileView {
    return this.toView(this.requireProfile(id))
  }

  create(input: ModelProfileInput, apiKey?: string): ModelProfileView {
    const parsed = ModelProfileInputSchema.parse(input)
    const active = parsed.enabled && this.dependencies.profiles.getActive() === null
    const timestamp = this.now()
    const profile: ModelProfileRecord = {
      id: this.createId(),
      ...parsed,
      active,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const apiKeyValue = apiKey?.trim()
    if (parsed.requiresApiKey && apiKeyValue) {
      this.saveProfileWithSecretChange(profile, { type: 'set', value: apiKeyValue })
    } else {
      this.dependencies.profiles.save(profile)
    }
    this.notifyChanged()
    return this.toView(profile)
  }

  update(id: string, input: ModelProfileInput, apiKey?: string): ModelProfileView {
    const existing = this.requireProfile(id)
    const parsed = ModelProfileInputSchema.parse(input)
    if (existing.active && !parsed.enabled) throw new Error('MODEL_PROFILE_ACTIVE_DISABLE_FORBIDDEN')
    const apiKeyValue = apiKey?.trim()
    const removesStoredKey = !parsed.requiresApiKey && this.dependencies.secrets.has(this.secretKey(id))
    const replacesStoredKey = parsed.requiresApiKey && Boolean(apiKeyValue)
    if (sameProfileConfiguration(existing, parsed) && !removesStoredKey && !replacesStoredKey) {
      return this.toView(existing)
    }
    const profile: ModelProfileRecord = {
      ...existing,
      ...parsed,
      updatedAt: this.now()
    }
    if (!parsed.requiresApiKey && this.dependencies.secrets.has(this.secretKey(id))) {
      this.saveProfileWithSecretChange(profile, { type: 'delete' })
    } else if (parsed.requiresApiKey && apiKeyValue) {
      this.saveProfileWithSecretChange(profile, { type: 'set', value: apiKeyValue })
    } else {
      this.dependencies.profiles.save(profile)
    }
    this.notifyChanged()
    return this.toView(profile)
  }

  setActive(id: string): ModelProfileView {
    this.requireProfile(id)
    this.dependencies.profiles.activate(id)
    this.notifyChanged()
    return this.get(id)
  }

  setApiKey(id: string, apiKey: string): void {
    const profile = this.requireProfile(id)
    if (!profile.requiresApiKey) throw new Error('MODEL_PROFILE_API_KEY_NOT_REQUIRED')
    const value = apiKey.trim()
    if (!value) throw new Error('MODEL_PROFILE_API_KEY_EMPTY')
    this.saveSecretWithCredentialRevision(id, { type: 'set', value })
    this.notifyChanged()
  }

  deleteApiKey(id: string): void {
    this.requireProfile(id)
    this.saveSecretWithCredentialRevision(id, { type: 'delete' })
    this.notifyChanged()
  }

  delete(id: string): void {
    const profile = this.requireProfile(id)
    const secretKey = this.secretKey(id)
    const snapshot = this.readSecretSnapshot(secretKey)
    const revision = this.credentialRevision(profile.id)
    if (snapshot.exists) {
      this.dependencies.secrets.delete(secretKey)
      try {
        this.writeCredentialRevision(profile.id, revision + 1)
      } catch (error) {
        this.rethrowAfterRollback(error, this.restoreSecret(secretKey, snapshot))
      }
    }
    try {
      this.dependencies.profiles.delete(profile.id)
    } catch (error) {
      const secretRollback = this.restoreSecret(secretKey, snapshot)
      const revisionRollback = snapshot.exists ? this.restoreCredentialRevision(profile.id, revision) : null
      this.rethrowAfterRollback(error, aggregateRollbackErrors(secretRollback, revisionRollback))
    }
    this.notifyChanged()
  }

  getActiveRuntimeProfile(): RuntimeModelProfile | null {
    const profile = this.dependencies.profiles.getActive()
    return profile
      ? this.toRuntimeProfile(profile, profile.requiresApiKey ? this.dependencies.secrets.get(this.secretKey(profile.id)) : null)
      : null
  }

  migrateLegacyProfile(): ModelProfileView | null {
    const marker = this.dependencies.settings.get<unknown>(LEGACY_MIGRATION_KEY)
    if (marker !== null) {
      const profileId = this.readMigrationProfileId(marker)
      return profileId ? this.dependencies.profiles.get(profileId) && this.get(profileId) : null
    }

    const legacy = this.dependencies.settings.get<LegacySettings>(LEGACY_SETTINGS_KEY)
    const providerId = readOptionalTrimmedString(legacy?.providerId)
    const modelId = readOptionalTrimmedString(legacy?.modelId)
    const customBaseUrl = readOptionalTrimmedString(legacy?.customBaseUrl)
    if (providerId === null || modelId === null || customBaseUrl === null) {
      this.dependencies.settings.set(LEGACY_MIGRATION_KEY, { profileId: null } satisfies LegacyMigrationMarker)
      return null
    }
    const provider = AI_PROVIDER_CATALOG.find((entry) => entry.id === providerId)
    const baseUrl = customBaseUrl || provider?.baseUrl
    if (!provider || !modelId || !baseUrl) {
      this.dependencies.settings.set(LEGACY_MIGRATION_KEY, { profileId: null } satisfies LegacyMigrationMarker)
      return null
    }

    const parsed = ModelProfileInputSchema.safeParse({
      name: provider.label,
      providerTemplate: provider.id,
      baseUrl,
      modelId,
      requiresApiKey: true,
      enabled: true
    })
    if (!parsed.success) {
      this.dependencies.settings.set(LEGACY_MIGRATION_KEY, { profileId: null } satisfies LegacyMigrationMarker)
      return null
    }

    const timestamp = this.now()
    const profile: ModelProfileRecord = {
      id: LEGACY_PROFILE_ID,
      ...parsed.data,
      active: true,
      createdAt: this.dependencies.profiles.get(LEGACY_PROFILE_ID)?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    this.dependencies.profiles.save(profile)
    const legacyKey = this.dependencies.secrets.get(`ai.${provider.id}`)
    if (legacyKey) this.dependencies.secrets.set(this.secretKey(profile.id), legacyKey)
    this.dependencies.settings.set(LEGACY_MIGRATION_KEY, { profileId: profile.id } satisfies LegacyMigrationMarker)
    return this.toView(profile)
  }

  async testConnection(input: ModelProfileInput, apiKey?: string, profileId?: string): Promise<ConnectionTestResult> {
    const parsed = ModelProfileInputSchema.parse(input)
    const savedProfile = profileId ? this.requireProfile(profileId) : null
    const providedKey = apiKey?.trim()
    const storedKey = !providedKey && parsed.requiresApiKey && savedProfile
      ? this.dependencies.secrets.get(this.secretKey(savedProfile.id))
      : null
    const profile = this.toRuntimeProfile({
      id: savedProfile?.id ?? 'draft',
      ...parsed,
      active: savedProfile?.active ?? false,
      createdAt: savedProfile?.createdAt ?? '',
      updatedAt: savedProfile?.updatedAt ?? ''
    }, providedKey || storedKey)
    if (!this.dependencies.connectionTester) {
      return { executed: false, ok: false, errorCode: 'MODEL_CONNECTION_TESTER_UNAVAILABLE' }
    }
    const startedAt = Date.now()
    try {
      const result = await this.dependencies.connectionTester(profile)
      this.logConnectionTest(profile.id, result.errorCode ?? null, Date.now() - startedAt)
      return result
    } catch (error) {
      const result = connectionFailureResult(error)
      this.logConnectionTest(profile.id, result.errorCode ?? null, Date.now() - startedAt)
      return result
    }
  }

  getActiveHealthIdentity(): ActiveModelHealthIdentity | null {
    const profile = this.dependencies.profiles.getActive()
    if (!profile) return null
    return {
      id: profile.id,
      providerTemplate: profile.providerTemplate as ProviderTemplate,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      updatedAt: profile.updatedAt,
      credentialRevision: this.credentialRevision(profile.id)
    }
  }

  async testActiveConnection(): Promise<ConnectionTestResult> {
    const profile = this.dependencies.profiles.getActive()
    if (!profile) return { executed: false, ok: false, errorCode: 'CLOUD_PROFILE_MISSING' }
    return this.testConnection({
      name: profile.name,
      providerTemplate: profile.providerTemplate as ProviderTemplate,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      requiresApiKey: profile.requiresApiKey,
      enabled: profile.enabled
    }, undefined, profile.id)
  }

  private requireProfile(id: string): ModelProfileRecord {
    const profile = this.dependencies.profiles.get(id)
    if (!profile) throw new Error('MODEL_PROFILE_NOT_FOUND')
    return profile
  }

  private toView(profile: ModelProfileRecord): ModelProfileView {
    return {
      ...profile,
      providerTemplate: profile.providerTemplate as ProviderTemplate,
      apiKeyConfigured: profile.requiresApiKey && this.dependencies.secrets.has(this.secretKey(profile.id))
    }
  }

  private toRuntimeProfile(profile: ModelProfileRecord, apiKey: string | null): RuntimeModelProfile {
    const providerTemplate = profile.providerTemplate as ProviderTemplate
    const provider = AI_PROVIDER_CATALOG.find((entry) => entry.id === providerTemplate)
    return {
      id: profile.id,
      name: profile.name,
      providerTemplate,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      requiresApiKey: profile.requiresApiKey,
      compatibility: provider?.compatibility ?? 'openai-compatible',
      apiKey: profile.requiresApiKey ? apiKey : null
    }
  }

  private saveProfileWithSecretChange(profile: ModelProfileRecord, change: SecretChange): void {
    const secretKey = this.secretKey(profile.id)
    const snapshot = this.readSecretSnapshot(secretKey)
    const revision = this.credentialRevision(profile.id)
    if (change.type === 'set') this.dependencies.secrets.set(secretKey, change.value)
    else this.dependencies.secrets.delete(secretKey)
    try {
      this.writeCredentialRevision(profile.id, revision + 1)
      this.dependencies.profiles.save(profile)
    } catch (error) {
      const secretRollback = this.restoreSecret(secretKey, snapshot)
      const revisionRollback = this.restoreCredentialRevision(profile.id, revision)
      this.rethrowAfterRollback(error, aggregateRollbackErrors(secretRollback, revisionRollback))
    }
  }

  private saveSecretWithCredentialRevision(id: string, change: SecretChange): void {
    const secretKey = this.secretKey(id)
    const snapshot = this.readSecretSnapshot(secretKey)
    const revision = this.credentialRevision(id)
    if (change.type === 'set') this.dependencies.secrets.set(secretKey, change.value)
    else this.dependencies.secrets.delete(secretKey)
    try {
      this.writeCredentialRevision(id, revision + 1)
    } catch (error) {
      this.rethrowAfterRollback(error, this.restoreSecret(secretKey, snapshot))
    }
  }

  private readSecretSnapshot(key: string): SecretSnapshot {
    if (!this.dependencies.secrets.has(key)) return { exists: false }
    const value = this.dependencies.secrets.get(key)
    return value === null ? { exists: false } : { exists: true, value }
  }

  private restoreSecret(key: string, snapshot: SecretSnapshot): unknown | null {
    try {
      if (snapshot.exists) this.dependencies.secrets.set(key, snapshot.value)
      else this.dependencies.secrets.delete(key)
      return null
    } catch (error) {
      return error
    }
  }

  private rethrowAfterRollback(operationError: unknown, rollbackError: unknown | null): never {
    if (rollbackError !== null) {
      throw new AggregateError([operationError, rollbackError], 'MODEL_PROFILE_SECRET_ROLLBACK_FAILED')
    }
    throw operationError
  }

  private secretKey(id: string): string {
    return `ai.profile.${id}`
  }

  private credentialRevision(id: string): number {
    const value = this.dependencies.settings.get<unknown>(`${CREDENTIAL_REVISION_PREFIX}${id}`)
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  }

  private writeCredentialRevision(id: string, revision: number): void {
    this.dependencies.settings.set(`${CREDENTIAL_REVISION_PREFIX}${id}`, revision)
  }

  private restoreCredentialRevision(id: string, revision: number): unknown | null {
    try {
      if (revision === 0) this.dependencies.settings.delete(`${CREDENTIAL_REVISION_PREFIX}${id}`)
      else this.writeCredentialRevision(id, revision)
      return null
    } catch (error) {
      return error
    }
  }

  private logConnectionTest(profileId: string, errorCode: string | null, durationMs: number): void {
    this.dependencies.connectionLogger?.({ profileId, errorCode, durationMs })
  }

  private notifyChanged(): void {
    try {
      this.dependencies.onChanged?.()
    } catch {
      // Profile/secret persistence already committed. A stale health badge is
      // safer than incorrectly reporting this successful mutation as failed.
    }
  }

  private readMigrationProfileId(marker: unknown): string | null {
    if (!marker || typeof marker !== 'object') return null
    const profileId = (marker as Partial<LegacyMigrationMarker>).profileId
    return typeof profileId === 'string' && profileId ? profileId : null
  }
}

function sameProfileConfiguration(profile: ModelProfileRecord, input: ModelProfileInput): boolean {
  return profile.name === input.name
    && profile.providerTemplate === input.providerTemplate
    && profile.baseUrl === input.baseUrl
    && profile.modelId === input.modelId
    && profile.requiresApiKey === input.requiresApiKey
    && profile.enabled === input.enabled
}

function connectionFailureResult(error: unknown): ConnectionTestResult {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (/AI_HTTP_40[13]/.test(message)) {
    return { executed: true, ok: false, errorCode: 'INVALID_API_KEY', message: 'API Key 无效或没有访问权限。' }
  }
  if (/AI_HTTP_404/.test(message)) {
    return { executed: true, ok: false, errorCode: 'MODEL_NOT_FOUND', message: '模型 ID 不存在，或当前接口无法访问该模型。' }
  }
  if (message === 'AI_EMPTY_RESPONSE') {
    return { executed: true, ok: false, errorCode: 'EMPTY_RESPONSE', message: '模型没有返回有效内容，请检查模型是否可用。' }
  }
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('abort')) {
    return { executed: true, ok: false, errorCode: 'CONNECTION_TIMEOUT', message: '连接超时，请检查接口地址和网络后重试。' }
  }
  if (normalized.includes('json') || normalized.includes('syntax')) {
    return { executed: true, ok: false, errorCode: 'INCOMPATIBLE_RESPONSE', message: '接口返回格式不兼容，请确认使用 OpenAI Chat Completions 兼容接口。' }
  }
  return { executed: true, ok: false, errorCode: 'CONNECTION_FAILED', message: '无法连接到模型服务，请检查接口地址和网络。' }
}

function aggregateRollbackErrors(...errors: Array<unknown | null>): unknown | null {
  const failures = errors.filter((error): error is unknown => error !== null)
  return failures.length === 0 ? null : failures.length === 1 ? failures[0] : new AggregateError(failures, 'MODEL_PROFILE_SECRET_ROLLBACK_FAILED')
}
