import { GeneratedAnalysisSchema, type AnalysisResult } from './analysis-schema'
import { ANALYSIS_SYSTEM_PROMPT, wrapUntrustedTranscript } from './prompt'
import type { ChatCompletionClient, ChatCompletionRequest, TokenUsage } from './provider-types'

export interface AnalysisOutput { analysis: AnalysisResult; usage: TokenUsage }

interface SafeValidationIssue {
  path: string
  code: string
}

interface AnalysisAttemptDiagnostic {
  phase: 'initial' | 'repair' | 'regeneration'
  issues: SafeValidationIssue[]
}

export interface AnalysisInvalidDiagnostic {
  attempts: AnalysisAttemptDiagnostic[]
}

type AnalysisParseResult =
  | { success: true; analysis: AnalysisResult }
  | { success: false; issues: SafeValidationIssue[] }

const STRICT_ANALYSIS_SHAPE = `严格按以下 JSON 结构重新生成，所有值必须来自文字稿，不要照抄示例说明：
{
  "topicCategory": "2-12 字的具体创作方向",
  "contentKeywords": ["2-12 字完整主题词组", "2-12 字完整主题词组"],
  "topicAngle": "选题角度",
  "openingHook": { "quote": "原文钩子", "type": "钩子类型", "mechanism": "生效机制" },
  "structure": ["结构步骤"],
  "viralPoints": ["爆点"],
  "highlights": ["亮点"],
  "reusablePatterns": ["可复用模式"],
  "differentiatedSuggestions": {
    "angles": ["差异化角度"],
    "titles": ["标题建议"],
    "openings": ["开头建议"],
    "risks": ["风险提醒"]
  }
}`

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join('；')
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${formatValue(item)}`).filter((item) => !item.endsWith('：')).join('；')
  return ''
}

function toStringArray(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean)
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${formatValue(item)}`).filter((item) => !item.endsWith('：'))
  return value
}

function normalizeAnalysis(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const analysis = { ...(value as Record<string, unknown>) }
  for (const field of ['contentKeywords', 'structure', 'viralPoints', 'highlights', 'reusablePatterns']) analysis[field] = toStringArray(analysis[field])
  if (analysis.differentiatedSuggestions && typeof analysis.differentiatedSuggestions === 'object' && !Array.isArray(analysis.differentiatedSuggestions)) {
    const suggestions = { ...(analysis.differentiatedSuggestions as Record<string, unknown>) }
    for (const field of ['angles', 'titles', 'openings', 'risks']) suggestions[field] = toStringArray(suggestions[field])
    analysis.differentiatedSuggestions = suggestions
  }
  return analysis
}

function extractJsonObject(content: string): string {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = normalized.indexOf('{')
  if (start < 0) return normalized
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return normalized.slice(start, index + 1)
    }
  }
  return normalized
}

function parseAnalysis(content: string): AnalysisParseResult {
  let value: unknown
  try {
    value = normalizeAnalysis(JSON.parse(extractJsonObject(content)) as unknown)
  } catch {
    return { success: false, issues: [{ path: '$', code: 'invalid_json' }] }
  }
  const parsed = GeneratedAnalysisSchema.safeParse(value)
  if (parsed.success) return { success: true, analysis: parsed.data }
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '$',
      code: issue.code
    }))
  }
}

function isEmptyResponse(error: unknown): boolean { return error instanceof Error && error.message === 'AI_EMPTY_RESPONSE' }

function issueSummary(issues: SafeValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')
}

function repairInstruction(issues: SafeValidationIssue[]): string {
  return `上一份 JSON 未通过校验。失败字段：${issueSummary(issues)}。\n${STRICT_ANALYSIS_SHAPE}\n只返回一个合法 JSON 对象，不要返回 Markdown、解释或 interactionGuidance。`
}

function invalidAnalysisError(attempts: AnalysisAttemptDiagnostic[]): Error & { code: string; diagnostic: AnalysisInvalidDiagnostic } {
  const error = new Error('AI_ANALYSIS_INVALID') as Error & { code: string; diagnostic: AnalysisInvalidDiagnostic }
  error.code = 'AI_ANALYSIS_INVALID'
  error.diagnostic = { attempts }
  return error
}

export class AnalysisService {
  constructor(private readonly client: ChatCompletionClient) {}

  async analyze(transcript: string): Promise<AnalysisOutput> {
    const request: ChatCompletionRequest = {
      messages: [{ role: 'system', content: ANALYSIS_SYSTEM_PROMPT }, { role: 'user', content: wrapUntrustedTranscript(transcript) }],
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: 'json_object'
    }
    let first
    try { first = await this.client.complete(request) } catch (error) {
      if (!isEmptyResponse(error)) throw error
      first = await this.client.complete(request)
    }
    const attempts: AnalysisAttemptDiagnostic[] = []
    const initial = parseAnalysis(first.content)
    if (initial.success) return { analysis: initial.analysis, usage: first.usage }
    attempts.push({ phase: 'initial', issues: initial.issues })

    const repaired = await this.client.complete({
      ...request,
      messages: [...request.messages, { role: 'assistant', content: first.content }, {
        role: 'user', content: repairInstruction(initial.issues)
      }]
    })
    const repair = parseAnalysis(repaired.content)
    if (repair.success) return { analysis: repair.analysis, usage: repaired.usage }
    attempts.push({ phase: 'repair', issues: repair.issues })

    const regenerated = await this.client.complete({
      ...request,
      messages: [...request.messages, { role: 'user', content: repairInstruction(repair.issues) }]
    })
    const regeneration = parseAnalysis(regenerated.content)
    if (regeneration.success) return { analysis: regeneration.analysis, usage: regenerated.usage }
    attempts.push({ phase: 'regeneration', issues: regeneration.issues })
    throw invalidAnalysisError(attempts)
  }
}
