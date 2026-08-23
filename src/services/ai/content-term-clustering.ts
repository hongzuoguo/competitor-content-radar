import { z } from 'zod'
import type { ChatCompletionClient, ChatCompletionRequest } from './provider-types'

export interface ContentTermCandidateWork {
  id: string
  title: string
  candidates: string[]
}

export interface ContentTermClusterResult {
  terms: Array<{ name: string, workIds: string[] }>
}

const ContentTermEnvelopeSchema = z.object({
  terms: z.array(z.unknown())
}).strict()

const ContentTermSchema = z.object({
  name: z.string().trim().refine((value) => {
    const length = Array.from(value).length
    return length >= 2 && length <= 16
  }, 'CONTENT_TERM_NAME_LENGTH'),
  workIds: z.array(z.string().min(1)).min(1)
}).strict()

export class ContentTermClusteringService {
  constructor(private readonly client: ChatCompletionClient) {}

  async cluster(works: ContentTermCandidateWork[]): Promise<ContentTermClusterResult> {
    const request: ChatCompletionRequest = {
      messages: [
        { role: 'system', content: contentTermClusteringInstructions() },
        { role: 'user', content: `<candidate_works>\n${JSON.stringify(works)}\n</candidate_works>` }
      ],
      temperature: 0.1,
      maxTokens: 2048,
      responseFormat: 'json_object'
    }
    let response
    try {
      response = await this.client.complete(request)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'AI_EMPTY_RESPONSE') throw error
      response = await this.client.complete(request)
    }
    return parseAndValidateContentTerms(response.content, works)
  }
}

export function buildContentTermClusteringPrompt(works: ContentTermCandidateWork[]): string {
  return [
    contentTermClusteringInstructions(),
    '',
    `<candidate_works>\n${JSON.stringify(works)}\n</candidate_works>`,
    '',
    '只返回 JSON，不要解释。'
  ].join('\n')
}

function contentTermClusteringInstructions(): string {
  return [
    '你是短视频内容研究员。nodejieba 已从作品标题机械拆出候选短语，请做语义复核和聚类。',
    '合并同义词、近义词和被拆散的短语；删除数量词、虚词、句子残片以及“内容、视频、方法”等泛词。',
    '不得直接使用创作方向或同等级宽泛类别作为词条，例如“AI效率工具、内容创作、创业”。',
    '保留能指导创作的具体人物、场景、工具、问题和动作，例如“县城老板获客、企业知识库搭建、短视频拆解”。',
    '同一作品可以对应多个词条；没有参考价值的作品可以不分配。最多输出 30 个词条。',
    '只返回 JSON：{"terms":[{"name":"企业知识库搭建","workIds":["id"]}]}。'
  ].join('\n')
}

export function parseAndValidateContentTerms(
  content: string,
  works: ContentTermCandidateWork[]
): ContentTermClusterResult {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(normalized) as unknown
  } catch {
    throw new Error('AI_CONTENT_TERM_RESPONSE_INVALID')
  }
  const envelope = ContentTermEnvelopeSchema.safeParse(raw)
  if (!envelope.success) throw new Error('AI_CONTENT_TERM_RESPONSE_INVALID')
  const parsed = envelope.data
  const validIds = new Set(works.map((work) => work.id))
  const terms = new Map<string, { name: string, workIds: string[] }>()
  for (const candidate of parsed.terms) {
    const result = ContentTermSchema.safeParse(candidate)
    if (!result.success || result.data.workIds.some((id) => !validIds.has(id))) continue
    const key = normalize(result.data.name)
    if (!key) continue
    const existing = terms.get(key)
    if (existing) {
      for (const workId of result.data.workIds) {
        if (!existing.workIds.includes(workId)) existing.workIds.push(workId)
      }
    } else {
      terms.set(key, { name: result.data.name, workIds: [...new Set(result.data.workIds)] })
    }
  }
  if (parsed.terms.length > 0 && terms.size === 0) {
    throw new Error('AI_CONTENT_TERM_NO_VALID_TERMS')
  }
  return { terms: [...terms.values()].slice(0, 30) }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}
