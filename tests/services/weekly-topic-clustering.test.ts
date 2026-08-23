import { describe, expect, it, vi } from 'vitest'
import type { ChatCompletionClient } from '../../src/services/ai/provider-types'
import {
  WeeklyTopicClusteringService,
  buildWeeklyTopicClusteringPrompt,
  parseAndValidateCluster
} from '../../src/services/ai/weekly-topic-clustering'

describe('weekly topic clustering', () => {
  it('builds a reusable Chinese prompt and parses fenced Codex JSON output', () => {
    const works = [
      { id: 'work-1', title: '工具一', topicAngle: '工具', viralPoints: [] },
      { id: 'work-2', title: '工具二', topicAngle: '工具', viralPoints: [] }
    ]

    const prompt = buildWeeklyTopicClusteringPrompt(works, ['AI工具与效率'])
    expect(prompt).toContain('短视频内容策略分析师')
    expect(prompt).toContain('AI工具与效率')
    expect(prompt).toContain('优先沿用')
    expect(parseAndValidateCluster('```json\n{"categories":[{"name":"AI工具分享","workIds":["work-1","work-2"]}]}\n```', works)).toEqual({
      categories: [{ name: 'AI工具分享', workIds: ['work-1', 'work-2'] }]
    })
  })

  it('allows a single category when every viral work belongs to the same topic', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        categories: [{ name: 'AI工具分享', workIds: ['work-1', 'work-2', 'work-3'] }]
      }),
      usage: { inputTokens: 10, outputTokens: 10 }
    })
    const service = new WeeklyTopicClusteringService({ complete } as ChatCompletionClient)

    await expect(service.cluster([
      { id: 'work-1', title: '工具一', topicAngle: '工具', viralPoints: [] },
      { id: 'work-2', title: '工具二', topicAngle: '工具', viralPoints: [] },
      { id: 'work-3', title: '工具三', topicAngle: '工具', viralPoints: [] }
    ], ['AI工具与效率'])).resolves.toEqual({
      categories: [{ name: 'AI工具分享', workIds: ['work-1', 'work-2', 'work-3'] }]
    })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('AI工具与效率') })
      ])
    }))
  })

  it('rejects duplicate category names after trimming and case normalization', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        categories: [
          { name: 'AI Tools', workIds: ['work-1'] },
          { name: ' ai tools ', workIds: ['work-2'] }
        ]
      }),
      usage: { inputTokens: 10, outputTokens: 10 }
    })
    const service = new WeeklyTopicClusteringService({ complete } as ChatCompletionClient)

    await expect(service.cluster([
      { id: 'work-1', title: '工具一', topicAngle: '工具', viralPoints: [] },
      { id: 'work-2', title: '工具二', topicAngle: '工具', viralPoints: [] }
    ])).rejects.toThrow('CATEGORY_NAME_DUPLICATE')
  })

  it('accepts useful dynamic category names longer than eight characters', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        categories: [
          { name: 'AI工具实操与效率提升', workIds: ['work-1'] },
          { name: 'AI行业趋势与前瞻判断', workIds: ['work-2'] },
          { name: 'AI认知方法与经验交流', workIds: ['work-3'] }
        ]
      }),
      usage: { inputTokens: 10, outputTokens: 10 }
    })
    const service = new WeeklyTopicClusteringService({ complete } as ChatCompletionClient)

    await expect(service.cluster([
      { id: 'work-1', title: '工具作品', topicAngle: '效率', viralPoints: [] },
      { id: 'work-2', title: '趋势作品', topicAngle: '趋势', viralPoints: [] },
      { id: 'work-3', title: '认知作品', topicAngle: '认知', viralPoints: [] }
    ])).resolves.toEqual({ categories: [
      { name: 'AI工具实操与效率提升', workIds: ['work-1'] },
      { name: 'AI行业趋势与前瞻判断', workIds: ['work-2'] },
      { name: 'AI认知方法与经验交流', workIds: ['work-3'] }
    ] })
  })
})
