export function isRiskControlText(value: string): boolean {
  try {
    return hasRiskControlSignal(JSON.parse(value) as unknown)
  } catch {
    return hasChallengeMeaning(value)
  }
}

function hasRiskControlSignal(value: unknown): boolean {
  if (typeof value === 'string') return hasChallengeMeaning(value)
  if (Array.isArray(value)) return value.some(hasRiskControlSignal)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    if (/^(?:captcha|captcha_(?:code|status)|risk_control(?:_(?:code|status))?|challenge_status)$/i.test(key)) {
      return isActiveChallengeValue(nested)
    }
    return hasRiskControlSignal(nested)
  })
}

function isActiveChallengeValue(value: unknown): boolean {
  if (value === true || (typeof value === 'number' && value > 0)) return true
  return typeof value === 'string' && (
    hasChallengeMeaning(value) || (/^\d+$/.test(value) && Number(value) > 0)
  )
}

function hasChallengeMeaning(value: string): boolean {
  return /验证码|安全验证|人机验证|访问过于频繁|需要.{0,8}验证|captcha[_-]?challenge|risk[_-]?control[_-]?challenge/i.test(value)
}
