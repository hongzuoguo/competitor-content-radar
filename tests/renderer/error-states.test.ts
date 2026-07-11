import { describe, expect, it } from 'vitest'
import { recoveryMessage } from '../../src/renderer/src/features/errors/recovery-message'

describe('actionable recovery messages', () => {
  it('explains authentication, balance, permission and offline failures', () => {
    expect(recoveryMessage('DOUYIN_AUTH_EXPIRED').action).toBe('重新登录抖音')
    expect(recoveryMessage('AI_BALANCE_INSUFFICIENT').title).toBe('AI 账户余额不足')
    expect(recoveryMessage('FEISHU_PERMISSION_REVOKED').action).toBe('重新授权飞书')
    expect(recoveryMessage('OFFLINE').description).toContain('网络恢复后')
  })
})
