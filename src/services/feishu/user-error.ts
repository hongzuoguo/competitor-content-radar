import { feishuUserErrorForCode, type FeishuErrorCode, type FeishuUserError } from '../../shared/ipc-contract'

export type { FeishuErrorCode, FeishuUserError } from '../../shared/ipc-contract'

const PERMISSION_API_CODES = new Set(['91403', '1254302', '1254304', '99991672'])

export function toFeishuUserError(error: unknown): FeishuUserError {
  try {
    return feishuUserErrorForCode(classifyFeishuError(error))
  } catch {
    return feishuUserErrorForCode('FEISHU_UNKNOWN_ERROR')
  }
}

function classifyFeishuError(error: unknown): FeishuErrorCode {
  const stableCode = stableErrorCode(error)
  if (stableCode === 'FEISHU_BASE_MISSING') return 'FEISHU_BASE_MISSING'
  if (stableCode === 'FEISHU_BASE_URL_INVALID') return 'FEISHU_URL_INVALID'
  if (stableCode === 'FEISHU_WIKI_NOT_BITABLE') return 'FEISHU_WIKI_NOT_BITABLE'
  if (isSecretCode(stableCode)) return 'FEISHU_SECRET_INVALID'
  if (permissionApiCode(stableCode)) return 'FEISHU_PERMISSION_DENIED'
  if (isNetworkCode(stableCode)) return 'FEISHU_NETWORK_ERROR'

  const httpStatus = stableHttpStatus(error)
  if (httpStatus === '401') return 'FEISHU_SECRET_INVALID'
  if (httpStatus === '403') return 'FEISHU_PERMISSION_DENIED'
  if (httpStatus === '408' || httpStatus === '429' || httpStatus?.startsWith('5')) return 'FEISHU_NETWORK_ERROR'

  const message = error instanceof Error ? error.message : ''
  if (/\b(network|timeout|timed out|fetch failed)\b|网络|超时/ui.test(message)) return 'FEISHU_NETWORK_ERROR'
  if (/\b(permission denied|forbidden|access denied)\b|权限|拒绝访问/ui.test(message)) return 'FEISHU_PERMISSION_DENIED'
  if (/\b(credentials?|app[ _-]?secret|app[ _-]?id|unauthorized)\b|凭证/ui.test(message)) return 'FEISHU_SECRET_INVALID'
  return 'FEISHU_UNKNOWN_ERROR'
}

function stableErrorCode(error: unknown): string | null {
  const explicitCode = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (typeof explicitCode === 'string' && /^FEISHU_[A-Z0-9_]+$/u.test(explicitCode)) return explicitCode
  const message = error instanceof Error ? error.message : ''
  return /\b(FEISHU_[A-Z0-9_]+)\b/u.exec(message)?.[1] ?? null
}

function isSecretCode(code: string | null): boolean {
  return code === 'FEISHU_HTTP_401'
    || code === 'FEISHU_CUSTOM_APP_AUTH_HTTP_401'
    || code === 'FEISHU_CUSTOM_APP_CREDENTIALS_INVALID'
    || code === 'FEISHU_CUSTOM_APP_ID_INVALID'
    || code === 'FEISHU_CUSTOM_APP_SECRET_REQUIRED'
}

function permissionApiCode(code: string | null): boolean {
  if (code === 'FEISHU_HTTP_403' || code === 'FEISHU_CUSTOM_APP_AUTH_HTTP_403') return true
  const match = /^FEISHU_API_(\d+)$/u.exec(code ?? '')
  return Boolean(match?.[1] && PERMISSION_API_CODES.has(match[1]))
}

function isNetworkCode(code: string | null): boolean {
  if (code === 'FEISHU_CUSTOM_APP_AUTH_NETWORK') return true
  const status = stableHttpStatus(code)
  return status === '408' || status === '429' || Boolean(status?.startsWith('5'))
}

function stableHttpStatus(error: unknown): string | null {
  const source = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  return /\b(?:FEISHU_(?:CUSTOM_APP_AUTH_)?|)HTTP_(\d{3})\b/u.exec(source)?.[1] ?? null
}
