import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_SECRET_KEY = 'agent.accessToken'
const ENABLED_SETTING_KEY = 'agent.enabled'
const PORT_SETTING_KEY = 'agent.port'

interface SettingsLike {
  get<T = unknown>(key: string): T | null
  set(key: string, value: unknown): void
}

interface SecretsLike {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

interface PendingConfirmation {
  digest: string
  expiresAt: number
}

export class AgentAccessService {
  private readonly confirmations = new Map<string, PendingConfirmation>()
  private readonly randomBytes: (size: number) => Buffer
  private readonly now: () => number

  constructor(
    private readonly dependencies: { settings: SettingsLike, secrets: SecretsLike },
    options: { randomBytes?: (size: number) => Buffer, now?: () => number } = {}
  ) {
    this.randomBytes = options.randomBytes ?? nodeRandomBytes
    this.now = options.now ?? Date.now
  }

  getState(): { enabled: boolean, port: number | null } {
    return {
      enabled: this.dependencies.settings.get<boolean>(ENABLED_SETTING_KEY) ?? true,
      port: this.dependencies.settings.get<number>(PORT_SETTING_KEY)
    }
  }

  setEnabled(enabled: boolean): void {
    this.dependencies.settings.set(ENABLED_SETTING_KEY, enabled)
  }

  setPort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('AGENT_PORT_INVALID')
    this.dependencies.settings.set(PORT_SETTING_KEY, port)
  }

  ensureToken(): string {
    const existing = this.dependencies.secrets.get(TOKEN_SECRET_KEY)
    if (existing) return existing
    return this.resetToken()
  }

  resetToken(): string {
    const token = this.randomBytes(32).toString('base64url')
    this.dependencies.secrets.set(TOKEN_SECRET_KEY, token)
    this.confirmations.clear()
    return token
  }

  authenticate(candidate: string): boolean {
    const expected = this.dependencies.secrets.get(TOKEN_SECRET_KEY)
    if (!expected || !candidate) return false
    const expectedDigest = createHash('sha256').update(expected).digest()
    const candidateDigest = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(expectedDigest, candidateDigest)
  }

  issueConfirmation(capability: string, input: unknown): { token: string, expiresAt: string } {
    this.pruneConfirmations()
    const token = this.randomBytes(24).toString('base64url')
    const expiresAt = this.now() + 60_000
    this.confirmations.set(token, { digest: operationDigest(capability, input), expiresAt })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  consumeConfirmation(token: string, capability: string, input: unknown): boolean {
    this.pruneConfirmations()
    const pending = this.confirmations.get(token)
    if (!pending || pending.digest !== operationDigest(capability, input)) return false
    this.confirmations.delete(token)
    return true
  }

  private pruneConfirmations(): void {
    const now = this.now()
    for (const [token, pending] of this.confirmations) {
      if (pending.expiresAt <= now) this.confirmations.delete(token)
    }
  }
}

function operationDigest(capability: string, input: unknown): string {
  return createHash('sha256').update(`${capability}\n${stableJson(input)}`).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
