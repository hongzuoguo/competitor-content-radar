import { describe, expect, it } from 'vitest'
import { FEISHU_BASE_SCHEMA } from '../../src/services/feishu/schema'

describe('Feishu Bitable schema', () => {
  it('uses a versioned schema named 对标内容雷达', () => {
    expect(FEISHU_BASE_SCHEMA.name).toBe('对标内容雷达')
    expect(FEISHU_BASE_SCHEMA.version).toBe(3)
  })

  it('defines the operational tables plus managed growth, direction and content-term summaries', () => {
    expect(FEISHU_BASE_SCHEMA.tables.map((table) => table.key)).toEqual([
      'creators',
      'works',
      'worksArchive',
      'snapshots',
      'growthTop10',
      'directions',
      'contentTerms'
    ])
  })

  it('provides the confirmed analysis views', () => {
    expect(FEISHU_BASE_SCHEMA.views.map((view) => view.name)).toEqual([
      '🔥 超级爆款池',
      '我的作品',
      '对标作品',
      '今日新增',
      '相对爆款',
      '绝对高点赞',
      '钩子素材库',
      '选题素材库'
    ])
  })

  it('keeps relative-only works out of the super viral view', () => {
    const superViralView = FEISHU_BASE_SCHEMA.views.find((view) => view.name === '🔥 超级爆款池')

    expect(superViralView?.filters).toEqual({
      conjunction: 'or',
      conditions: [
        { fieldKey: 'highlightReasons', operator: 'contains', value: '绝对高点赞' },
        { fieldKey: 'highlightReasons', operator: 'contains', value: '高收藏' },
        { fieldKey: 'highlightReasons', operator: 'contains', value: '高评论' },
        { fieldKey: 'highlightReasons', operator: 'contains', value: '高转发' }
      ]
    })
    expect(JSON.stringify(superViralView)).not.toContain('相对表现')
  })

  it('filters the 相对爆款 view using the relative-performance highlight category', () => {
    const relativeHighlightView = FEISHU_BASE_SCHEMA.views.find((view) => view.name === '相对爆款')

    expect(relativeHighlightView?.filter).toEqual({
      fieldKey: 'highlightReasons',
      operator: 'contains',
      value: '相对表现'
    })
  })

  it('includes traceability fields on work analyses', () => {
    const works = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'works')
    expect(works?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        '作品ID',
        '作品归属',
        '原视频',
        '完整文案',
        'AI提供商',
        '模型ID',
        '提示词版本'
      ])
    )
  })

  it('manages the account type used by template dashboards on current and archived works', () => {
    for (const tableKey of ['works', 'worksArchive']) {
      const table = FEISHU_BASE_SCHEMA.tables.find((candidate) => candidate.key === tableKey)
      expect(table?.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'accountType', name: '账号类型', type: 'text' })
      ]))
    }
  })

  it('hides compatibility fields from user-facing views without deleting them', () => {
    const works = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'works')
    const archive = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'worksArchive')
    const directions = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'directions')

    expect(works?.defaultViewHiddenFieldKeys).toContain('accountType')
    expect(archive?.defaultViewHiddenFieldKeys).toContain('accountType')
    expect(directions?.defaultViewHiddenFieldKeys).toBeUndefined()
    expect(FEISHU_BASE_SCHEMA.views.every((view) => view.hiddenFieldKeys.includes('accountType'))).toBe(true)
  })

  it('defines deterministic identity fields for every table', () => {
    expect(FEISHU_BASE_SCHEMA.tables.map((table) => table.identityField)).toEqual([
      'creatorId',
      'workId',
      'workId',
      'snapshotId',
      'rankingId',
      'directionId',
      'termId'
    ])
  })

  it('replaces reports with an actionable creative-direction table', () => {
    const directions = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'directions')

    expect(directions?.name).toBe('创作方向')
    expect(directions?.fields.map((field) => field.name)).toEqual([
      '方向ID', '创作方向', '作品数量', '平均互动', '近7天增长',
      '代表关键词', '代表作品', '建议级别'
    ])
    expect(FEISHU_BASE_SCHEMA.tables.some((table) => table.name === '报告')).toBe(false)
  })

  it('defines the fields required by the seven-day growth dashboard', () => {
    const ranking = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'growthTop10')

    expect(ranking?.name).toBe('近7天增速TOP10')
    expect(ranking?.fields.map((field) => field.name)).toEqual([
      '榜单ID', '排名', '标题', '博主名称', '近7天增速（%）',
      '互动增长量', '最新互动量', '短标题', '原视频'
    ])
  })

  it('defines a dedicated table for concrete word-cloud terms', () => {
    const terms = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'contentTerms')

    expect(terms?.name).toBe('热门内容词')
    expect(terms?.defaultViewHiddenFieldKeys).toBeUndefined()
    expect(terms?.fields.map((field) => field.name)).toEqual([
      '词条ID', '热门内容词', '作品数量', '内容热度', '平均互动', '代表作品'
    ])
  })
})
