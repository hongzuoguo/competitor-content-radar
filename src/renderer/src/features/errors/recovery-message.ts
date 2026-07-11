export interface RecoveryMessage {
  title: string
  description: string
  action: string
}

const MESSAGES: Record<string, RecoveryMessage> = {
  DOUYIN_AUTH_EXPIRED: {
    title: '抖音登录已过期',
    description: '重新扫码登录后，任务会从采集阶段继续。',
    action: '重新登录抖音'
  },
  DOUYIN_RISK_CONTROL: {
    title: '抖音需要安全验证',
    description: '请在打开的抖音窗口中手动完成验证；应用不会绕过验证码。',
    action: '打开验证窗口'
  },
  AI_BALANCE_INSUFFICIENT: {
    title: 'AI 账户余额不足',
    description: '充值或切换已配置的模型后，可从 AI 拆解阶段重试。',
    action: '检查 AI 设置'
  },
  FEISHU_PERMISSION_REVOKED: {
    title: '飞书授权已失效',
    description: '历史本地数据仍然保留；重新授权后只补同步未写入的记录。',
    action: '重新授权飞书'
  },
  OFFLINE: {
    title: '当前无法连接网络',
    description: '已完成的本地步骤不会丢失，网络恢复后会从中断阶段继续。',
    action: '重新检查网络'
  }
}

export function recoveryMessage(code: string): RecoveryMessage {
  return MESSAGES[code] ?? {
    title: '任务暂时无法继续',
    description: '查看任务记录中的失败阶段和诊断信息后重试。',
    action: '查看任务记录'
  }
}
