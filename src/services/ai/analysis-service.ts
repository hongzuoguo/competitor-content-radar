import { AnalysisSchema, type AnalysisResult } from './analysis-schema'
import { ANALYSIS_SYSTEM_PROMPT, wrapUntrustedTranscript } from './prompt'
import type {
  ChatCompletionClient,
  ChatCompletionRequest,
  TokenUsage
} from './provider-types'

export interface AnalysisOutput {
  analysis: AnalysisResult
  usage: TokenUsage
}

function parseAnalysis(content: string): AnalysisResult {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return AnalysisSchema.parse(JSON.parse(normalized) as unknown)
}

export class AnalysisService {
  constructor(private readonly client: ChatCompletionClient) {}

  async analyze(transcript: string): Promise<AnalysisOutput> {
    const request: ChatCompletionRequest = {
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: wrapUntrustedTranscript(transcript) }
      ],
      temperature: 0.2,
      responseFormat: 'json_object'
    }

    const first = await this.client.complete(request)
    try {
      return { analysis: parseAnalysis(first.content), usage: first.usage }
    } catch {
      const repaired = await this.client.complete({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: first.content },
          {
            role: 'user',
            content: '上一次输出不符合约定结构。请修复字段和类型，只返回合法 JSON。'
          }
        ]
      })
      try {
        return { analysis: parseAnalysis(repaired.content), usage: repaired.usage }
      } catch {
        throw new Error('AI_ANALYSIS_INVALID')
      }
    }
  }
}
