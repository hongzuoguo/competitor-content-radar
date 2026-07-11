export interface FeishuOAuthConfig {
  appId: string
  appSecret: string
  redirectUri: string
}

export interface FeishuTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export function buildFeishuAuthorizationUrl(config: FeishuOAuthConfig, state: string): string {
  const url = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize')
  url.searchParams.set('app_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeFeishuCode(
  config: FeishuOAuthConfig,
  code: string,
  fetchImplementation: typeof fetch = fetch
): Promise<FeishuTokenResponse> {
  const response = await fetchImplementation('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri
    })
  })
  if (!response.ok) throw new Error(`FEISHU_OAUTH_HTTP_${response.status}`)
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!data.access_token || !data.refresh_token) throw new Error('FEISHU_OAUTH_INVALID_RESPONSE')
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 0
  }
}
