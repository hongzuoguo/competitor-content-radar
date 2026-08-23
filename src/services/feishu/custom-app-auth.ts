const TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000

export interface FeishuCustomAppCredentials {
  appId: string
  appSecret: string
}

export type FeishuBaseReference =
  | { kind: 'base'; appToken: string; tableId: string | null }
  | { kind: 'wiki'; nodeToken: string; tableId: string | null }

export interface FeishuAccessTokenProvider {
  getAccessToken(): Promise<string>
}

interface FeishuTenantTokenProviderOptions {
  fetchImplementation?: typeof fetch
  now?: () => number
  log?: (message: string, detail?: unknown) => void
}

interface TenantTokenResponse {
  code?: number
  msg?: string
  tenant_access_token?: string
  expire?: number
}

export class FeishuTenantTokenProvider implements FeishuAccessTokenProvider {
  private readonly credentials: FeishuCustomAppCredentials
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private readonly log?: (message: string, detail?: unknown) => void
  private cachedToken: { value: string; expiresAt: number } | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(
    credentials: FeishuCustomAppCredentials,
    options: FeishuTenantTokenProviderOptions = {}
  ) {
    this.credentials = normalizeCredentials(credentials)
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.now = options.now ?? Date.now
    this.log = options.log
  }

  async getAccessToken(): Promise<string> {
    if (
      this.cachedToken
      && this.cachedToken.expiresAt - this.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.cachedToken.value
    }
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async refresh(): Promise<string> {
    this.log?.('requesting Feishu tenant access token')
    let response: Response
    try {
      response = await this.fetchImplementation(TENANT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.credentials.appId,
          app_secret: this.credentials.appSecret
        })
      })
    } catch {
      this.log?.('Feishu tenant token request failed', { reason: 'network' })
      throw codedError('FEISHU_CUSTOM_APP_AUTH_NETWORK')
    }

    let payload: TenantTokenResponse
    try {
      payload = await response.json() as TenantTokenResponse
    } catch {
      this.log?.('Feishu tenant token request failed', {
        reason: 'invalid_response',
        status: response.status
      })
      throw codedError('FEISHU_CUSTOM_APP_AUTH_INVALID_RESPONSE')
    }

    if (!response.ok || payload.code !== 0) {
      this.log?.('Feishu tenant token request rejected', {
        status: response.status,
        code: payload.code ?? null
      })
      if (response.status === 400 || response.status === 401 || payload.code !== 0) {
        throw codedError('FEISHU_CUSTOM_APP_CREDENTIALS_INVALID')
      }
      throw codedError(`FEISHU_CUSTOM_APP_AUTH_HTTP_${response.status}`)
    }

    const token = payload.tenant_access_token
    const expiresInSeconds = payload.expire
    if (!token || !Number.isFinite(expiresInSeconds) || Number(expiresInSeconds) <= 0) {
      this.log?.('Feishu tenant token request failed', {
        reason: 'invalid_response',
        status: response.status,
        code: payload.code ?? null
      })
      throw codedError('FEISHU_CUSTOM_APP_AUTH_INVALID_RESPONSE')
    }

    this.cachedToken = {
      value: token,
      expiresAt: this.now() + Number(expiresInSeconds) * 1_000
    }
    this.log?.('Feishu tenant access token ready', {
      expiresInSeconds: Number(expiresInSeconds)
    })
    return token
  }
}

export function parseFeishuBaseReference(value: string): FeishuBaseReference {
  const input = value.trim()
  if (!input) throw codedError('FEISHU_BASE_URL_INVALID')

  if (isAppToken(input)) {
    return {
      kind: 'base',
      appToken: input,
      tableId: null
    }
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw codedError('FEISHU_BASE_URL_INVALID')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || (hostname !== 'feishu.cn' && !hostname.endsWith('.feishu.cn'))
  ) {
    throw codedError('FEISHU_BASE_URL_INVALID')
  }

  const path = /^\/(base|wiki)\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
  if (!path) {
    throw codedError('FEISHU_BASE_URL_INVALID')
  }

  const tableId = isAppToken(url.searchParams.get('table') ?? '')
    ? url.searchParams.get('table')
    : null
  const [, kind, token] = path
  if (kind === 'base') return { kind, appToken: token, tableId }
  return { kind: 'wiki', nodeToken: token, tableId }
}

function normalizeCredentials(credentials: FeishuCustomAppCredentials): FeishuCustomAppCredentials {
  const appId = credentials.appId.trim()
  const appSecret = credentials.appSecret.trim()
  if (!/^cli_[A-Za-z0-9]+$/.test(appId)) throw codedError('FEISHU_CUSTOM_APP_ID_INVALID')
  if (!appSecret) throw codedError('FEISHU_CUSTOM_APP_SECRET_REQUIRED')
  return { appId, appSecret }
}

function isAppToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function codedError(code: string): Error {
  return new Error(code)
}
