import { z } from 'zod'
import type { ChatCompletionClient, ChatCompletionRequest } from './provider-types'

export interface WeeklyTopicWork {
  id: string
  title: string
  topicAngle: string
  viralPoints: string[]
  topicCategory?: string
  contentKeywords?: string[]
}

export interface WeeklyTopicCategory {
  name: string
  workIds: string[]
}

export interface WeeklyTopicClusterResult {
  categories: WeeklyTopicCategory[]
}

const WeeklyTopicClusterSchema = z.object({
  categories: z.array(z.object({
    name: z.string().trim().refine((value) => Array.from(value).length >= 2 && Array.from(value).length <= 16, 'CATEGORY_NAME_LENGTH'),
    workIds: z.array(z.string().min(1)).min(1)
  })).min(1).max(8).superRefine((categories, context) => {
    const names = new Set<string>()
    for (const category of categories) {
      const normalizedName = category.name.trim().toLocaleLowerCase()
      if (names.has(normalizedName)) {
        context.addIssue({ code: 'custom', message: 'CATEGORY_NAME_DUPLICATE' })
      }
      names.add(normalizedName)
    }
  })
})

export class WeeklyTopicClusteringService {
  constructor(private readonly client: ChatCompletionClient) {}

  async cluster(works: WeeklyTopicWork[], preferredCategoryNames: string[] = []): Promise<WeeklyTopicClusterResult> {
    const request: ChatCompletionRequest = {
      messages: [
        {
          role: 'system',
          content: weeklyTopicClusteringInstructions(preferredCategoryNames)
        },
        {
          role: 'user',
          content: `<weekly_viral_works>\n${JSON.stringify(works)}\n</weekly_viral_works>`
        }
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
    return parseAndValidateCluster(response.content, works)
  }
}

export function buildWeeklyTopicClusteringPrompt(
  works: WeeklyTopicWork[],
  preferredCategoryNames: string[] = []
): string {
  return [
    weeklyTopicClusteringInstructions(preferredCategoryNames),
    '',
    `<weekly_viral_works>\n${JSON.stringify(works)}\n</weekly_viral_works>`,
    '',
    '只返回 JSON，不要解释。'
  ].join('\n')
}

function weeklyTopicClusteringInstructions(preferredCategoryNames: string[] = []): string {
  const instructions = [
    '你是短视频内容策略分析师。请把同一自然周的爆款作品做全局选题聚类。',
    '自主归纳 1 到 8 个互不重叠的主题；相似方向必须合并，只有真正独立的方向才单独成类。',
    '类别名使用 2 到 16 个字符的简洁中文短语，可以包含 AI 等必要英文缩写，不得复述单条作品标题。',
    '每条作品必须且只能归入一个类别。只返回 JSON：{"categories":[{"name":"AI工具分享","workIds":["id"]}]}。'
  ]
  const preferred = preferredCategoryNames.map((name) => name.trim()).filter(Boolean)
  if (preferred.length > 0) {
    instructions.splice(2, 0, `以下是上次已使用的大类名称。语义仍匹配时优先沿用，只有确实出现新的独立方向才新建：${preferred.join('、')}。`)
  }
  return instructions.join('\n')
}

export function parseAndValidateCluster(content: string, works: WeeklyTopicWork[]): WeeklyTopicClusterResult {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = WeeklyTopicClusterSchema.parse(JSON.parse(normalized) as unknown)
  const expected = new Set(works.map((work) => work.id))
  const assigned = parsed.categories.flatMap((category) => category.workIds)
  if (assigned.length !== expected.size || new Set(assigned).size !== assigned.length) {
    throw new Error('AI_WEEKLY_TOPIC_ASSIGNMENT_INVALID')
  }
  if (assigned.some((id) => !expected.has(id)) || [...expected].some((id) => !assigned.includes(id))) {
    throw new Error('AI_WEEKLY_TOPIC_ASSIGNMENT_INVALID')
  }
  return parsed
}
