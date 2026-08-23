import type { SettingsRepository } from '../database/repositories'

export const FEISHU_SYNC_STATE_KEY = 'feishu.syncState'

export interface FeishuSyncState {
  mode: 'auto' | 'manual'
  localRevision: number
  syncedRevision: number
  lastSyncAttemptAt: string | null
  lastSyncSucceededAt: string | null
  lastErrorCode: string | null
}

export type FeishuSyncStateView = FeishuSyncState & { hasPendingChanges: boolean }

type SettingsStore = Pick<SettingsRepository, 'get' | 'set'>

const DEFAULT_STATE: FeishuSyncState = {
  mode: 'auto',
  localRevision: 0,
  syncedRevision: 0,
  lastSyncAttemptAt: null,
  lastSyncSucceededAt: null,
  lastErrorCode: null
}

const TRUSTED_FIXED_ERROR_CODES = new Set([
  'FEISHU_BASE_MISSING',
  'FEISHU_BASE_SCHEMA',
  'FEISHU_BASE_SELECTION_REQUIRED',
  'FEISHU_SCHEMA_NEEDS_REPAIR',
  'FEISHU_NOT_AUTHORIZED',
  'FEISHU_NOT_CONNECTED',
  'FEISHU_BASE_UNAVAILABLE',
  'FEISHU_SYNC_FAILED'
])

export class FeishuSyncCoordinator {
  private state: FeishuSyncState
  private inFlight: Promise<void> | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly syncAll: () => Promise<unknown>,
    private readonly now: () => Date = () => new Date(),
    initialMode?: FeishuSyncState['mode']
  ) {
    this.state = loadState(this.settings, initialMode)
    this.persist()
  }

  getState(): FeishuSyncStateView {
    return {
      ...this.state,
      hasPendingChanges: this.state.localRevision > this.state.syncedRevision
    }
  }

  setMode(mode: FeishuSyncState['mode']): void {
    if (this.state.mode === mode) return
    const previous = this.state
    this.state = { ...this.state, mode }
    try {
      this.persist()
    } catch (error) {
      this.state = previous
      throw error
    }
  }

  markLocalChange(): void {
    this.state = { ...this.state, localRevision: this.state.localRevision + 1 }
    this.persist()
  }

  flushAfterTask(): Promise<void> {
    if (this.state.mode !== 'auto' || !this.getState().hasPendingChanges) return Promise.resolve()
    if (this.inFlight) return this.inFlight.then(() => this.flushAfterTask())
    return this.flush()
  }

  syncNow(): Promise<void> {
    return this.flush()
  }

  private flush(): Promise<void> {
    if (this.inFlight) return this.inFlight

    const targetRevision = this.state.localRevision
    this.state = {
      ...this.state,
      lastSyncAttemptAt: this.now().toISOString(),
      lastErrorCode: null
    }
    this.persist()

    const operation = Promise.resolve()
      .then(() => this.syncAll())
      .then(
        () => {
          this.state = {
            ...this.state,
            syncedRevision: Math.max(this.state.syncedRevision, targetRevision),
            lastSyncSucceededAt: this.now().toISOString(),
            lastErrorCode: null
          }
          this.persist()
        },
        (error: unknown) => {
          this.state = { ...this.state, lastErrorCode: errorCode(error) }
          this.persist()
          throw error
        }
      )
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null
      })

    this.inFlight = operation
    return operation
  }

  private persist(): void {
    this.settings.set(FEISHU_SYNC_STATE_KEY, this.state)
  }
}

function normalizeState(value: unknown): FeishuSyncState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return recoveryState()

  const candidate = value as Partial<Record<keyof FeishuSyncState, unknown>>
  const localRevision = revision(candidate.localRevision)
  const syncedRevision = revision(candidate.syncedRevision)
  const metadata: Pick<FeishuSyncState, 'mode' | 'lastSyncAttemptAt' | 'lastSyncSucceededAt' | 'lastErrorCode'> = {
    mode: candidate.mode === 'manual' ? 'manual' : 'auto',
    lastSyncAttemptAt: isoTimestamp(candidate.lastSyncAttemptAt),
    lastSyncSucceededAt: isoTimestamp(candidate.lastSyncSucceededAt),
    lastErrorCode: trustedErrorCode(candidate.lastErrorCode)
  }

  if (localRevision === null || syncedRevision === null || syncedRevision > localRevision) {
    return {
      ...metadata,
      localRevision: Math.max(localRevision ?? 0, 1),
      syncedRevision: 0
    }
  }

  return {
    ...metadata,
    localRevision,
    syncedRevision
  }
}

function loadState(settings: SettingsStore, initialMode?: FeishuSyncState['mode']): FeishuSyncState {
  try {
    const value = settings.get<unknown>(FEISHU_SYNC_STATE_KEY)
    return value === null || value === undefined
      ? { ...DEFAULT_STATE, mode: initialMode ?? DEFAULT_STATE.mode }
      : normalizeState(value)
  } catch {
    return recoveryState()
  }
}

function recoveryState(): FeishuSyncState {
  return { ...DEFAULT_STATE, mode: 'manual', localRevision: 1 }
}

function revision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function isoTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function trustedErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (/^FEISHU_(?:API|HTTP)_\d+$/.test(value)) return value
  return TRUSTED_FIXED_ERROR_CODES.has(value) ? value : null
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = trustedErrorCode((error as { code: unknown }).code)
    if (code) return code
  }

  if (error instanceof Error) {
    const code = trustedMessageCode(error.message)
    if (code) return code
  }

  return 'FEISHU_SYNC_FAILED'
}

function trustedMessageCode(message: string): string | null {
  const exactCode = trustedErrorCode(message)
  if (exactCode) return exactCode

  const match = message.match(/^(FEISHU_(?:API|HTTP)_\d+):/)
  return match?.[1] ?? null
}
