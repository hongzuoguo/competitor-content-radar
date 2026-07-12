import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: { fromPartition: vi.fn() }
}))

import { isDouyinJsonResponse, isRiskControlText } from '../../src/services/douyin/session'
import { extractWorkFromPayload } from '../../src/services/douyin/discovery'

describe('Douyin session response guards', () => {
  it('does not treat ordinary verification metadata as risk control', () => {
    const payload = {
      verify_status: 1,
      enterprise_verify_reason: 'approved',
      aweme_detail: { aweme_id: '7658', desc: 'valid target', video: { play_addr: { url_list: ['https://media.test/7658'] } } }
    }

    expect(isRiskControlText(JSON.stringify(payload))).toBe(false)
    expect(extractWorkFromPayload('7658', payload)).toMatchObject({ title: 'valid target' })
  })

  it('does not treat disabled risk metadata as a challenge and preserves the target work', () => {
    const payload = {
      captcha_enabled: false,
      risk_control_status: 0,
      captcha_provider: 'internal',
      aweme_detail: { aweme_id: '7658', desc: 'benign target', video: { play_addr: { url_list: ['https://media.test/7658'] } } }
    }

    expect(isRiskControlText(JSON.stringify(payload))).toBe(false)
    expect(extractWorkFromPayload('7658', payload)).toMatchObject({ title: 'benign target' })
  })

  it.each(['请完成安全验证', '访问过于频繁，请稍后再试', '{"code":"captcha_challenge"}']) (
    'detects explicit risk-control challenge %s',
    (value) => expect(isRiskControlText(value)).toBe(true)
  )

  it.each([
    { captcha_status: 1 },
    { captcha_code: '1' },
    { risk_control_status: 2 },
    { message: '需要验证码才能继续访问' }
  ])('detects challenge semantics in JSON metadata %#', (value) => {
    expect(isRiskControlText(JSON.stringify(value))).toBe(true)
  })

  it.each([
    ['https://www.douyin.com/aweme/v1/web/aweme/detail/', true],
    ['https://douyin.com/api', true],
    ['https://evil-douyin.com/api', false],
    ['http://www.douyin.com/api', false],
    ['not a url', false]
  ])('validates JSON response URL %s', (url, expected) => {
    expect(isDouyinJsonResponse({ mimeType: 'application/json', url })).toBe(expected)
  })
})
