import { describe, expect, it } from 'vitest'
import { FEISHU_BASE_SCHEMA } from '../../src/services/feishu/schema'

describe('Feishu Bitable schema', () => {
  it('defines the four confirmed linked tables', () => {
    expect(FEISHU_BASE_SCHEMA.tables.map((table) => table.key)).toEqual([
      'creators',
      'works',
      'snapshots',
      'reports'
    ])
  })

  it('provides the confirmed analysis views', () => {
    expect(FEISHU_BASE_SCHEMA.views.map((view) => view.name)).toEqual([
      '今日新增',
      '相对爆款',
      '绝对高点赞',
      '高借鉴价值',
      '钩子素材库',
      '选题素材库'
    ])
  })

  it('includes traceability fields on work analyses', () => {
    const works = FEISHU_BASE_SCHEMA.tables.find((table) => table.key === 'works')
    expect(works?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['作品ID', '原视频', '完整文案', 'AI提供商', '模型ID', '提示词版本'])
    )
  })
})
