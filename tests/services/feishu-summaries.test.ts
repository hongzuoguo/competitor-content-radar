import { describe, expect, it } from 'vitest'
import type { Work } from '../../src/core/domain'
import type { MetricSnapshotRecord } from '../../src/services/database/repositories'
import {
  buildCreativeDirections,
  buildGrowthTop10,
  buildHotContentTerms,
  type FeishuSummaryWork
} from '../../src/services/feishu/summaries'

const now = new Date('2026-08-07T12:00:00.000Z')

describe('Feishu managed summaries', () => {
  it('ranks positive seven-day engagement growth using two in-window snapshots', () => {
    const works = [
      summaryWork('work-a', '作品 A', '甲', 'AI 工具', 'AI、效率', 200),
      summaryWork('work-b', '作品 B', '乙', '内容创作', '选题、标题', 500),
      summaryWork('work-c', '作品 C', '丙', 'AI 工具', 'AI、教程', 50)
    ]
    const snapshots = [
      snapshot('work-a', '2026-08-01T12:00:00.000Z', 100),
      snapshot('work-a', '2026-08-07T10:00:00.000Z', 200),
      snapshot('work-b', '2026-08-02T12:00:00.000Z', 400),
      snapshot('work-b', '2026-08-07T10:00:00.000Z', 500),
      snapshot('work-c', '2026-08-07T09:00:00.000Z', 50)
    ]

    expect(buildGrowthTop10(works, snapshots, now)).toEqual([
      expect.objectContaining({ id: 'growth-top-1', rank: 1, workId: 'work-a', growthRate: 100, engagementGrowth: 100 }),
      expect.objectContaining({ id: 'growth-top-2', rank: 2, workId: 'work-b', growthRate: 25, engagementGrowth: 100 })
    ])
  })

  it('excludes flat, declining and out-of-window histories and returns at most ten rows', () => {
    const works = Array.from({ length: 13 }, (_, index) => (
      summaryWork(`work-${index}`, `作品 ${index}`, '博主', '效率工具', '效率、工具', 100 + index)
    ))
    const snapshots = works.flatMap((item, index) => [
      snapshot(item.work.id, index === 11 ? '2026-07-01T00:00:00.000Z' : '2026-08-01T12:00:00.000Z', 100),
      snapshot(item.work.id, '2026-08-07T10:00:00.000Z', index === 12 ? 90 : 110 + index)
    ])

    const rows = buildGrowthTop10(works, snapshots, now)

    expect(rows).toHaveLength(10)
    expect(rows.every((row) => row.growthRate > 0)).toBe(true)
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 10 }, (_, index) => `growth-top-${index + 1}`))
    expect(rows.some((row) => row.workId === 'work-11')).toBe(false)
    expect(rows.some((row) => row.workId === 'work-12')).toBe(false)
  })

  it('does not invent percentage growth from a zero baseline', () => {
    const works = [summaryWork('zero', '零基数作品', '甲', 'AI 工具', '效率工具', 422)]
    const snapshots = [
      snapshot('zero', '2026-08-01T12:00:00.000Z', 0),
      snapshot('zero', '2026-08-07T10:00:00.000Z', 422)
    ]

    expect(buildGrowthTop10(works, snapshots, now)).toEqual([])
  })

  it('uses the first positive snapshot as the percentage baseline', () => {
    const works = [summaryWork('recovered', '恢复作品', '甲', 'AI 工具', '效率工具', 500)]
    const snapshots = [
      snapshot('recovered', '2026-08-01T12:00:00.000Z', 0),
      snapshot('recovered', '2026-08-03T12:00:00.000Z', 400),
      snapshot('recovered', '2026-08-07T10:00:00.000Z', 500)
    ]

    expect(buildGrowthTop10(works, snapshots, now)[0]).toMatchObject({
      growthRate: 25,
      engagementGrowth: 100
    })
  })

  it('groups works into actionable creative directions without another AI request', () => {
    const works = [
      summaryWork('ai-1', 'AI 自动剪辑教程', '甲', 'AI 工具', 'AI、剪辑、效率', 1_000),
      summaryWork('ai-2', 'AI 写作实测', '乙', 'AI 工具', 'AI、写作、效率', 600),
      summaryWork('finance-1', '财务月结清单', '丙', '财务管理', '财务、月结', 300),
      summaryWork('career-1', '转行避坑', '丁', '职场成长', '转行、避坑', 100),
      summaryWork('career-2', '面试表达', '丁', '职场成长', '面试、表达', 100)
    ]
    const snapshots = [
      snapshot('ai-1', '2026-08-01T12:00:00.000Z', 500), snapshot('ai-1', '2026-08-07T10:00:00.000Z', 1_000),
      snapshot('ai-2', '2026-08-01T12:00:00.000Z', 400), snapshot('ai-2', '2026-08-07T10:00:00.000Z', 600)
    ]

    expect(buildCreativeDirections(works, snapshots, now)).toEqual([
      {
        id: 'direction:AI 工具', direction: 'AI 工具', workCount: 2,
        averageEngagement: 800, sevenDayGrowth: 700,
        keywords: '效率、剪辑、写作', representativeWork: 'AI 自动剪辑教程', recommendation: '优先跟进'
      },
      {
        id: 'direction:财务管理', direction: '财务管理', workCount: 1,
        averageEngagement: 300, sevenDayGrowth: 0,
        keywords: '月结', representativeWork: '财务月结清单', recommendation: '持续观察'
      },
      {
        id: 'direction:职场成长', direction: '职场成长', workCount: 2,
        averageEngagement: 100, sevenDayGrowth: 0,
        keywords: '转行、避坑、面试', representativeWork: '转行避坑', recommendation: '值得测试'
      }
    ])
  })

  it('keeps at most three specific peer keywords and removes direction fragments and generic media words', () => {
    const rows = buildCreativeDirections([
      summaryWork(
        'sales-1',
        '智能体自动获客实测',
        '甲',
        'AI智能体销售',
        'AI智能体销售、ai搞钱、智能、视频、AI',
        1_000
      ),
      summaryWork(
        'sales-2',
        '销售自动化复盘',
        '乙',
        'AI智能体销售',
        'ai搞钱、内容、工具、方法、教程、成交、WorkBuddy',
        800
      )
    ], [], now)

    expect(rows[0]?.keywords).toBe('ai搞钱、成交、WorkBuddy')
    expect(rows.every((row) => row.keywords.split('、').filter(Boolean).length <= 3)).toBe(true)
  })

  it('removes sentence fragments and keeps the more specific keyword when terms overlap', () => {
    const rows = buildCreativeDirections([
      summaryWork(
        'writing-1',
        '别只追热点：一个开场钩子让完播率提升',
        '甲',
        'AI内容创作技巧',
        'AI内容创作技巧、开场、别只、开场钩子、内容创作',
        1_000
      ),
      summaryWork(
        'writing-2',
        '国产智能体进入实用期',
        '乙',
        'AI内容创作技巧',
        '国产、结论、三步、进入、实用、执行、老板、设置、一周、意外、明显、提升、新手、内容创作、创作',
        800
      )
    ], [], now)

    expect(rows[0]?.keywords).toBe('开场钩子')
  })

  it('builds one weighted word-cloud row per AI-validated content term', () => {
    const works = [
      summaryWork('knowledge-1', '县城老板搭建企业知识库', '甲', 'AI效率工具', '企业知识库、本地获客', 1_000),
      summaryWork('knowledge-2', '企业知识库自动更新', '乙', 'AI效率工具', '企业知识库、自动更新', 600),
      summaryWork('video-1', '短视频爆款拆解', '丙', '内容创作', '短视频拆解、开场钩子', 400)
    ]

    expect(buildHotContentTerms(works, {
      terms: [
        { name: '企业知识库搭建', workIds: ['knowledge-1', 'knowledge-2'] },
        { name: '短视频拆解', workIds: ['video-1'] }
      ]
    })).toEqual([
      {
        id: 'term:企业知识库搭建',
        term: '企业知识库搭建',
        workCount: 2,
        totalEngagement: 1_600,
        averageEngagement: 800,
        representativeWork: '县城老板搭建企业知识库'
      },
      {
        id: 'term:短视频拆解',
        term: '短视频拆解',
        workCount: 1,
        totalEngagement: 400,
        averageEngagement: 400,
        representativeWork: '短视频爆款拆解'
      }
    ])
  })
})

function summaryWork(
  id: string,
  title: string,
  creatorName: string,
  category: string,
  keywords: string,
  engagement: number
): FeishuSummaryWork {
  const work: Work = {
    id,
    creatorId: `creator-${id}`,
    platformWorkId: id,
    sourceType: 'douyin_monitor',
    sourceKey: `douyin:${id}`,
    mediaPath: null,
    ownership: 'competitor',
    title,
    publishedAt: '2026-08-01T00:00:00.000Z',
    originalUrl: `https://www.douyin.com/video/${id}`,
    downloadUrl: null,
    metrics: { likes: engagement, comments: 0, shares: 0, collects: 0 }
  }
  return { work, creatorName, category, keywords }
}

function snapshot(workId: string, capturedAt: string, engagement: number): MetricSnapshotRecord {
  return {
    id: `${workId}:${capturedAt}`,
    workId,
    capturedAt,
    metrics: { likes: engagement, comments: 0, shares: 0, collects: 0 }
  }
}
