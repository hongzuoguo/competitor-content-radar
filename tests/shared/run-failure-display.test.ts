import { describe, expect, it } from 'vitest'
import { safeRunFailure } from '../../src/shared/run-failure-display'

describe('safe run failure display', () => {
  it.each([
    ['SCRAPLING_ENGINE_INTERNAL', 'discovery', '采集组件运行异常。'],
    ['AI_ANALYSIS_INVALID', 'analysis', 'AI 返回格式异常'],
    ['DOUYIN_LOGIN_REQUIRED', 'discovery', '抖音登录已失效'],
    ['SCRAPLING_ENGINE_MANIFEST_UNAVAILABLE', 'discovery', '在线组件更新暂时不可用'],
    ['SCRAPLING_ENGINE_DOWNLOAD_FAILED', 'discovery', '本地采集组件更新下载失败'],
    ['DOUYIN_RISK_CONTROL', 'discovery', '抖音要求完成安全验证'],
    ['DOUYIN_NETWORK_TIMEOUT', 'discovery', '连接抖音超时'],
    ['DOUYIN_CREATOR_COLLECTION_FAILED', 'discovery', '博主作品采集失败'],
    ['WORK_PROCESSING_FAILED', 'analysis', '作品处理失败'],
    ['FEISHU_SYNC_FAILED', 'feishu', '本地数据已保存']
  ] as const)('keeps the fixed message for %s in %s', (code, stage, expected) => {
    expect(safeRunFailure(code, stage).message).toContain(expected)
  })

  it.each([
    ['FEISHU_SYNC_FAILED', 'discovery'],
    ['DOUYIN_LOGIN_REQUIRED', 'feishu'],
    ['DOUYIN_LOGIN_REQUIRED', 'analysis']
  ] as const)('rejects cross-stage code %s in %s', (code, stage) => {
    expect(safeRunFailure(code, stage).code).toBe('UNKNOWN_FAILURE')
  })

  it('turns hostile unknown input into one generic code and message', () => {
    const result = safeRunFailure('Bearer secret C:\private\file stack stderr', 'analysis')
    expect(result).toEqual({ code: 'UNKNOWN_FAILURE', message: '任务处理失败，请稍后重试；连续失败时请反馈给开发者。' })
    expect(JSON.stringify(result)).not.toMatch(/Bearer|private|stack|stderr/)
  })
})
