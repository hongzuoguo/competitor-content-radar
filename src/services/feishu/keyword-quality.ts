const WEAK_KEYWORDS = new Set([
  'ai', 'agent', '智能', '视频', '内容', '工具', '方法', '教程',
  '开场', '结论', '测试', '三步', '别只', '国产', '进入', '实用',
  '执行', '老板', '设置', '一周', '意外', '明显', '提升', '新手'
])

export function normalizeKeyword(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

export function isWeakKeyword(value: string): boolean {
  return WEAK_KEYWORDS.has(normalizeKeyword(value))
}

export function isContainedByMoreSpecificKeyword(
  value: string,
  candidates: readonly string[]
): boolean {
  const normalized = normalizeKeyword(value)
  return candidates.some((candidate) => {
    const other = normalizeKeyword(candidate)
    return other !== normalized && other.length > normalized.length && other.includes(normalized)
  })
}
