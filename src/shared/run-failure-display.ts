import type { RunFailure } from './ipc-contract'

export const SAFE_RUN_FAILURES = {
  SCRAPLING_ENGINE_INTERNAL: '采集组件运行异常。请先点击「重试采集」；如果仍然失败，请重启应用并重新登录抖音后再试。连续失败时，请复制错误信息反馈给开发者。',
  AI_ANALYSIS_INVALID: 'AI 返回格式异常，自动修复和重新生成后仍未完成，请稍后重试。',
  DOUYIN_LOGIN_REQUIRED: '抖音登录已失效，请重新登录。',
  SCRAPLING_ENGINE_MANIFEST_UNAVAILABLE: '在线组件更新暂时不可用。',
  SCRAPLING_ENGINE_DOWNLOAD_FAILED: '本地采集组件更新下载失败，请稍后重试。',
  DOUYIN_RISK_CONTROL: '抖音要求完成安全验证，请稍后重试。',
  DOUYIN_NETWORK_TIMEOUT: '连接抖音超时，已自动重试；请检查网络后再试。',
  DOUYIN_CREATOR_COLLECTION_FAILED: '博主作品采集失败，请稍后重试。',
  WORK_PROCESSING_FAILED: '作品处理失败，请检查模型设置后重试。',
  FEISHU_SYNC_FAILED: '本地数据已保存，但飞书同步失败，请稍后重新同步。'
} as const

export type SafeRunFailureCode = keyof typeof SAFE_RUN_FAILURES
export type SafeRunFailureDisplay = Readonly<{ code: SafeRunFailureCode | 'UNKNOWN_FAILURE'; message: string }>

const STAGE_CODES: Record<RunFailure['stage'], ReadonlySet<SafeRunFailureCode>> = {
  discovery: new Set([
    'SCRAPLING_ENGINE_INTERNAL', 'DOUYIN_LOGIN_REQUIRED', 'SCRAPLING_ENGINE_MANIFEST_UNAVAILABLE',
    'SCRAPLING_ENGINE_DOWNLOAD_FAILED', 'DOUYIN_RISK_CONTROL', 'DOUYIN_NETWORK_TIMEOUT',
    'DOUYIN_CREATOR_COLLECTION_FAILED'
  ]),
  download: new Set(['WORK_PROCESSING_FAILED']),
  transcription: new Set(['WORK_PROCESSING_FAILED']),
  analysis: new Set(['AI_ANALYSIS_INVALID', 'WORK_PROCESSING_FAILED']),
  feishu: new Set(['FEISHU_SYNC_FAILED'])
}

const UNKNOWN_RUN_FAILURE: SafeRunFailureDisplay = Object.freeze({
  code: 'UNKNOWN_FAILURE',
  message: '任务处理失败，请稍后重试；连续失败时请反馈给开发者。'
})

export function safeRunFailure(code: unknown, stage: RunFailure['stage']): SafeRunFailureDisplay {
  const known = typeof code === 'string' && Object.hasOwn(SAFE_RUN_FAILURES, code)
    ? code as SafeRunFailureCode
    : null
  return known && STAGE_CODES[stage].has(known)
    ? Object.freeze({ code: known, message: SAFE_RUN_FAILURES[known] })
    : UNKNOWN_RUN_FAILURE
}
