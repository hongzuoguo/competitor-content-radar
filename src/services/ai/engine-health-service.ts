import type { SettingsRepository } from '../database/repositories'
import type { EngineHealthEntry, EngineHealthStatus, EngineHealthView } from '../../shared/ipc-contract'

export type { EngineHealthEntry, EngineHealthStatus, EngineHealthView }

const HEALTH_SETTINGS_KEY = 'engine.health.v1'

interface StoredEngineHealthView {
  cloud?: EngineHealthEntry
  codex?: EngineHealthEntry
  checking: boolean
}

/** A narrow boundary for the real probes added in the following task. */
export interface EngineHealthProbeResult {
  ok: boolean
  /** Must be a stable code, never a provider/CLI response. */
  code?: string
  /** Deliberately ignored: probe output must never enter persisted health. */
  message?: string
}

export interface EngineHealthProbe {
  /** Opaque, non-secret identity for the current effective configuration. */
  fingerprint(): string | null | Promise<string | null>
  probe(): Promise<EngineHealthProbeResult>
}

type SettingsStore = Pick<SettingsRepository, 'get' | 'set'>

export interface EngineHealthServiceDependencies {
  settings: SettingsStore
  cloud: EngineHealthProbe
  codex: EngineHealthProbe
  now?: () => string
}

const SAFE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  CLOUD_PROFILE_MISSING: '没有已启用的云端模型，请先配置并启用。',
  MODEL_CONNECTION_TESTER_UNAVAILABLE: '当前版本无法检测云端模型，请更新后重试。',
  INVALID_API_KEY: 'API Key 无效或没有访问权限，请检查凭据。',
  MODEL_NOT_FOUND: '模型不存在或当前接口无权访问该模型。',
  EMPTY_RESPONSE: '模型没有返回有效内容，请检查模型配置。',
  INCOMPATIBLE_RESPONSE: '接口返回格式不兼容，请检查服务地址。',
  CONNECTION_TIMEOUT: '连接超时，请检查网络后重试。',
  CLOUD_CONNECTION_FAILED: '云端模型检测失败，请检查地址、网络和凭据。',
  CODEX_CLI_NOT_FOUND: '未找到 Codex CLI，请安装后重试。',
  CODEX_LOGIN_REQUIRED: 'Codex 尚未登录，请先在终端完成登录。',
  CODEX_MODEL_UNAVAILABLE: 'Codex 模型不可用，请检查模型设置。',
  CODEX_PERMISSION_DENIED: 'Codex 没有执行权限，请检查账号或配额。',
  CODEX_RATE_LIMITED: 'Codex 请求过于频繁，请稍后重试。',
  CODEX_TIMEOUT: 'Codex 检测超时，请检查网络后重试。',
  CODEX_CONNECTION_FAILED: 'Codex 连接检测失败，请检查网络和登录状态后重试。',
  ENGINE_CHECK_FAILED: '检测失败，请检查配置后重试。'
}

function unknownEntry(fingerprint: string | null): EngineHealthEntry {
  return { status: 'unknown', checkedAt: null, fingerprint, code: null, message: null }
}

function checkingEntry(fingerprint: string | null): EngineHealthEntry {
  return { status: 'checking', checkedAt: null, fingerprint, code: null, message: null }
}

function isFingerprint(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 512)
}

function readStoredEntry(value: unknown): EngineHealthEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<EngineHealthEntry>
  if (!['unknown', 'checking', 'healthy', 'unhealthy'].includes(entry.status ?? '')) return null
  if (!isFingerprint(entry.fingerprint)) return null
  const fingerprint = entry.fingerprint
  if (entry.status === 'unknown' || entry.status === 'checking') {
    return { status: entry.status, checkedAt: null, fingerprint, code: null, message: null }
  }
  if (!isIsoTimestamp(entry.checkedAt)) return null
  if (entry.status === 'healthy') {
    return { status: 'healthy', checkedAt: entry.checkedAt, fingerprint, code: null, message: null }
  }
  return { status: 'unhealthy', checkedAt: entry.checkedAt, fingerprint, ...safeFailure(entry.code) }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value
}

function safeFailure(code: unknown): Pick<EngineHealthEntry, 'code' | 'message'> {
  const normalized = typeof code === 'string' ? code : ''
  const safeCode = Object.hasOwn(SAFE_FAILURE_MESSAGES, normalized) ? normalized : 'ENGINE_CHECK_FAILED'
  return { code: safeCode, message: SAFE_FAILURE_MESSAGES[safeCode] }
}

export class EngineHealthService {
  private readonly now: () => string
  private inFlight: Promise<EngineHealthView> | null = null
  private readonly versions = { cloud: 0, codex: 0 }

  constructor(private readonly dependencies: EngineHealthServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
  }

  async get(): Promise<EngineHealthView> {
    const [cloudFingerprint, codexFingerprint] = await this.fingerprints()
    const stored = this.readStored()
    return this.currentView(stored, cloudFingerprint, codexFingerprint)
  }

  /** Reads only the normalized persisted view; it never resolves fingerprints or runs probes. */
  peekPersisted(): EngineHealthView {
    const stored = this.readStored()
    const cloudFingerprint = stored?.cloud?.fingerprint ?? null
    const codexFingerprint = stored?.codex?.fingerprint ?? null
    if (stored?.checking === true && this.inFlight === null) {
      return {
        cloud: unknownEntry(cloudFingerprint),
        codex: unknownEntry(codexFingerprint),
        checking: false
      }
    }
    return {
      cloud: stored?.cloud ?? unknownEntry(cloudFingerprint),
      codex: stored?.codex ?? unknownEntry(codexFingerprint),
      checking: stored?.checking === true
    }
  }

  refreshAll(): Promise<EngineHealthView> {
    if (this.inFlight) return this.inFlight
    const versions = { ...this.versions }
    this.inFlight = this.refresh(versions).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  async invalidateCloud(): Promise<void> {
    await this.invalidate('cloud')
  }

  async invalidateCodex(): Promise<void> {
    await this.invalidate('codex')
  }

  /** Records a success already proven by a guarded main-process profile test. */
  async recordCloudSuccess(): Promise<EngineHealthView> {
    this.versions.cloud += 1
    const version = this.versions.cloud
    const [cloudFingerprint, codexFingerprint] = await this.fingerprints()
    if (this.versions.cloud !== version) return this.get()
    const stored = this.readStored()
    const current = this.currentView(stored, cloudFingerprint, codexFingerprint)
    const view: EngineHealthView = {
      cloud: { status: 'healthy', checkedAt: this.now(), fingerprint: cloudFingerprint, code: null, message: null },
      codex: current.codex,
      checking: current.checking
    }
    this.persist(view)
    return view
  }

  private async refresh(versions: Record<'cloud' | 'codex', number>): Promise<EngineHealthView> {
    const [cloudFingerprint, codexFingerprint] = await this.fingerprints()
    this.persist({
      cloud: checkingEntry(cloudFingerprint),
      codex: checkingEntry(codexFingerprint),
      checking: true
    })

    const [cloud, codex] = await Promise.all([
      this.probe(this.dependencies.cloud, cloudFingerprint),
      this.probe(this.dependencies.codex, codexFingerprint)
    ])
    const stored = this.readStored()
    const [completedCloud, completedCodex] = await Promise.all([
      this.completeEntry('cloud', versions.cloud, cloudFingerprint, cloud, stored?.cloud),
      this.completeEntry('codex', versions.codex, codexFingerprint, codex, stored?.codex)
    ])
    const view = {
      cloud: completedCloud,
      codex: completedCodex,
      checking: false
    }
    this.persist(view)
    return view
  }

  private async invalidate(engine: 'cloud' | 'codex'): Promise<void> {
    this.versions[engine] += 1
    const version = this.versions[engine]
    const immediate = this.peekPersisted()
    this.persist({
      ...immediate,
      [engine]: unknownEntry(null),
      checking: immediate.checking
    })
    const fingerprint = await this.dependencies[engine].fingerprint()
    if (this.versions[engine] !== version) return
    const current = this.peekPersisted()
    this.persist({
      ...current,
      [engine]: unknownEntry(fingerprint),
      checking: current.checking
    })
  }

  private async probe(probe: EngineHealthProbe, fingerprint: string | null): Promise<EngineHealthEntry> {
    try {
      const result = await probe.probe()
      if (result.ok) {
        return { status: 'healthy', checkedAt: this.now(), fingerprint, code: null, message: null }
      }
      return { status: 'unhealthy', checkedAt: this.now(), fingerprint, ...safeFailure(result.code) }
    } catch {
      return { status: 'unhealthy', checkedAt: this.now(), fingerprint, ...safeFailure(undefined) }
    }
  }

  private currentEntry(stored: EngineHealthEntry | undefined, fingerprint: string | null): EngineHealthEntry {
    if (!stored || stored.fingerprint !== fingerprint) return unknownEntry(fingerprint)
    return { ...stored }
  }

  private async completeEntry(
    engine: 'cloud' | 'codex',
    startedVersion: number,
    startedFingerprint: string | null,
    result: EngineHealthEntry,
    stored: EngineHealthEntry | undefined
  ): Promise<EngineHealthEntry> {
    const currentFingerprint = engine === 'cloud'
      ? await this.dependencies.cloud.fingerprint()
      : await this.dependencies.codex.fingerprint()
    if (this.versions[engine] !== startedVersion) {
      const latest = this.readStored()
      const latestEntry = engine === 'cloud' ? latest?.cloud : latest?.codex
      return latestEntry?.status === 'checking'
        ? unknownEntry(currentFingerprint)
        : this.currentEntry(latestEntry, currentFingerprint)
    }
    if (currentFingerprint !== startedFingerprint) {
      return this.currentEntry(stored, currentFingerprint)
    }
    return result
  }

  private readStored(): StoredEngineHealthView | null {
    const stored = this.dependencies.settings.get<unknown>(HEALTH_SETTINGS_KEY)
    if (!stored || typeof stored !== 'object') return null
    const view = stored as Partial<EngineHealthView>
    const cloud = readStoredEntry(view.cloud)
    const codex = readStoredEntry(view.codex)
    if (typeof view.checking !== 'boolean') return null
    return { cloud: cloud ?? undefined, codex: codex ?? undefined, checking: view.checking }
  }

  private currentView(
    stored: StoredEngineHealthView | null,
    cloudFingerprint: string | null,
    codexFingerprint: string | null
  ): EngineHealthView {
    if (stored?.checking === true && this.inFlight === null) {
      return {
        cloud: unknownEntry(cloudFingerprint),
        codex: unknownEntry(codexFingerprint),
        checking: false
      }
    }
    return {
      cloud: this.currentEntry(stored?.cloud, cloudFingerprint),
      codex: this.currentEntry(stored?.codex, codexFingerprint),
      checking: stored?.checking === true
        && (stored.cloud?.status === 'checking' || stored.codex?.status === 'checking')
    }
  }

  private persist(view: EngineHealthView): void {
    this.dependencies.settings.set(HEALTH_SETTINGS_KEY, {
      cloud: { ...view.cloud },
      codex: { ...view.codex },
      checking: view.checking
    })
  }

  private fingerprints(): Promise<[string | null, string | null]> {
    return Promise.all([this.dependencies.cloud.fingerprint(), this.dependencies.codex.fingerprint()])
  }
}
