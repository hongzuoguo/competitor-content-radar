export function validateFeishuRetentionDays(value: string): string {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) return '请输入 1 到 365 之间的整数'
  return ''
}
