export type FeishuFieldType = 'text' | 'number' | 'date' | 'url' | 'checkbox' | 'link'
export type FeishuTableKey =
  | 'creators'
  | 'works'
  | 'worksArchive'
  | 'snapshots'
  | 'growthTop10'
  | 'directions'
  | 'contentTerms'

export interface FeishuFieldDefinition {
  key: string
  name: string
  type: FeishuFieldType
  linkTo?: FeishuTableKey
}

export interface FeishuTableDefinition {
  key: FeishuTableKey
  name: string
  identityField: string
  fields: FeishuFieldDefinition[]
  defaultViewHiddenFieldKeys?: string[]
}

export interface FeishuViewFilter {
  fieldKey: string
  operator: 'is' | 'contains' | 'isNotEmpty'
  value?: string
}

export interface FeishuViewDefinition {
  name: string
  table: FeishuTableKey
  hiddenFieldKeys?: string[]
  filter?: FeishuViewFilter
  filters?: {
    conjunction: 'and' | 'or'
    conditions: FeishuViewFilter[]
  }
}

export const FEISHU_BASE_SCHEMA = {
  version: 3,
  name: '对标内容雷达',
  tables: [
    {
      key: 'creators',
      name: '博主',
      identityField: 'creatorId',
      fields: [
        { key: 'creatorId', name: '博主ID', type: 'text' },
        { key: 'name', name: '博主名称', type: 'text' },
        { key: 'accountType', name: '账号类型', type: 'text' },
        { key: 'profileUrl', name: '主页地址', type: 'url' },
        { key: 'enabled', name: '是否监控', type: 'checkbox' },
        { key: 'lastCollectedAt', name: '最后采集时间', type: 'date' }
      ]
    },
    {
      key: 'works',
      name: '作品分析',
      identityField: 'workId',
      defaultViewHiddenFieldKeys: ['accountType'],
      fields: [
        { key: 'workId', name: '作品ID', type: 'text' },
        { key: 'ownership', name: '作品归属', type: 'text' },
        { key: 'accountType', name: '账号类型', type: 'text' },
        { key: 'sourceType', name: '来源', type: 'text' },
        { key: 'creator', name: '博主', type: 'link', linkTo: 'creators' },
        { key: 'creatorName', name: '博主名称', type: 'text' },
        { key: 'title', name: '标题', type: 'text' },
        { key: 'publishedAt', name: '发布时间', type: 'date' },
        { key: 'originalUrl', name: '原视频', type: 'url' },
        { key: 'likes', name: '点赞量', type: 'number' },
        { key: 'comments', name: '评论量', type: 'number' },
        { key: 'shares', name: '分享量', type: 'number' },
        { key: 'collects', name: '收藏量', type: 'number' },
        { key: 'relativePerformance', name: '相对表现倍数', type: 'number' },
        { key: 'highlightReasons', name: '入选原因', type: 'text' },
        { key: 'topicCategory', name: '选题分类', type: 'text' },
        { key: 'contentKeywords', name: '内容关键词', type: 'text' },
        { key: 'topicAngle', name: '角度', type: 'text' },
        { key: 'openingHook', name: '钩子', type: 'text' },
        { key: 'contentStructure', name: '结构', type: 'text' },
        { key: 'viralPoint', name: '爆点', type: 'text' },
        { key: 'highlights', name: '亮点', type: 'text' },
        { key: 'reusablePattern', name: '可复用模式', type: 'text' },
        { key: 'differentiation', name: '差异化创作建议', type: 'text' },
        { key: 'transcript', name: '完整文案', type: 'text' },
        { key: 'provider', name: 'AI提供商', type: 'text' },
        { key: 'model', name: '模型ID', type: 'text' },
        { key: 'promptVersion', name: '提示词版本', type: 'text' }
      ]
    },
    {
      key: 'worksArchive',
      name: '归档作品',
      identityField: 'workId',
      defaultViewHiddenFieldKeys: ['accountType'],
      fields: [
        { key: 'workId', name: '作品ID', type: 'text' },
        { key: 'ownership', name: '作品归属', type: 'text' },
        { key: 'accountType', name: '账号类型', type: 'text' },
        { key: 'sourceType', name: '来源', type: 'text' },
        { key: 'creator', name: '博主', type: 'link', linkTo: 'creators' },
        { key: 'creatorName', name: '博主名称', type: 'text' },
        { key: 'title', name: '标题', type: 'text' },
        { key: 'publishedAt', name: '发布时间', type: 'date' },
        { key: 'originalUrl', name: '原视频', type: 'url' },
        { key: 'likes', name: '点赞量', type: 'number' },
        { key: 'comments', name: '评论量', type: 'number' },
        { key: 'shares', name: '分享量', type: 'number' },
        { key: 'collects', name: '收藏量', type: 'number' },
        { key: 'relativePerformance', name: '相对表现倍数', type: 'number' },
        { key: 'highlightReasons', name: '入选原因', type: 'text' },
        { key: 'topicCategory', name: '选题分类', type: 'text' },
        { key: 'contentKeywords', name: '内容关键词', type: 'text' },
        { key: 'topicAngle', name: '角度', type: 'text' },
        { key: 'openingHook', name: '钩子', type: 'text' },
        { key: 'contentStructure', name: '结构', type: 'text' },
        { key: 'viralPoint', name: '爆点', type: 'text' },
        { key: 'highlights', name: '亮点', type: 'text' },
        { key: 'reusablePattern', name: '可复用模式', type: 'text' },
        { key: 'differentiation', name: '差异化创作建议', type: 'text' },
        { key: 'transcript', name: '完整文案', type: 'text' },
        { key: 'provider', name: 'AI提供商', type: 'text' },
        { key: 'model', name: '模型ID', type: 'text' },
        { key: 'promptVersion', name: '提示词版本', type: 'text' }
      ]
    },
    {
      key: 'snapshots',
      name: '每日指标快照',
      identityField: 'snapshotId',
      fields: [
        { key: 'snapshotId', name: '快照ID', type: 'text' },
        { key: 'work', name: '作品', type: 'link', linkTo: 'works' },
        { key: 'capturedAt', name: '采集时间', type: 'date' },
        { key: 'likes', name: '点赞量', type: 'number' },
        { key: 'comments', name: '评论量', type: 'number' },
        { key: 'shares', name: '分享量', type: 'number' },
        { key: 'collects', name: '收藏量', type: 'number' }
      ]
    },
    {
      key: 'growthTop10',
      name: '近7天增速TOP10',
      identityField: 'rankingId',
      fields: [
        { key: 'rankingId', name: '榜单ID', type: 'text' },
        { key: 'rank', name: '排名', type: 'number' },
        { key: 'title', name: '标题', type: 'text' },
        { key: 'creatorName', name: '博主名称', type: 'text' },
        { key: 'growthRate', name: '近7天增速（%）', type: 'number' },
        { key: 'engagementGrowth', name: '互动增长量', type: 'number' },
        { key: 'latestEngagement', name: '最新互动量', type: 'number' },
        { key: 'shortTitle', name: '短标题', type: 'text' },
        { key: 'originalUrl', name: '原视频', type: 'url' }
      ]
    },
    {
      key: 'directions',
      name: '创作方向',
      identityField: 'directionId',
      fields: [
        { key: 'directionId', name: '方向ID', type: 'text' },
        { key: 'direction', name: '创作方向', type: 'text' },
        { key: 'workCount', name: '作品数量', type: 'number' },
        { key: 'averageEngagement', name: '平均互动', type: 'number' },
        { key: 'sevenDayGrowth', name: '近7天增长', type: 'number' },
        { key: 'keywords', name: '代表关键词', type: 'text' },
        { key: 'representativeWork', name: '代表作品', type: 'text' },
        { key: 'recommendation', name: '建议级别', type: 'text' }
      ]
    },
    {
      key: 'contentTerms',
      name: '热门内容词',
      identityField: 'termId',
      fields: [
        { key: 'termId', name: '词条ID', type: 'text' },
        { key: 'term', name: '热门内容词', type: 'text' },
        { key: 'workCount', name: '作品数量', type: 'number' },
        { key: 'totalEngagement', name: '内容热度', type: 'number' },
        { key: 'averageEngagement', name: '平均互动', type: 'number' },
        { key: 'representativeWork', name: '代表作品', type: 'text' }
      ]
    }
  ] satisfies FeishuTableDefinition[],
  views: [
    {
      name: '🔥 超级爆款池',
      table: 'works',
      hiddenFieldKeys: ['accountType'],
      filters: {
        conjunction: 'or',
        conditions: [
          { fieldKey: 'highlightReasons', operator: 'contains', value: '绝对高点赞' },
          { fieldKey: 'highlightReasons', operator: 'contains', value: '高收藏' },
          { fieldKey: 'highlightReasons', operator: 'contains', value: '高评论' },
          { fieldKey: 'highlightReasons', operator: 'contains', value: '高转发' }
        ]
      }
    },
    { name: '我的作品', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'ownership', operator: 'is', value: '我的作品' } },
    { name: '对标作品', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'ownership', operator: 'is', value: '对标作品' } },
    { name: '今日新增', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'publishedAt', operator: 'is', value: 'Today' } },
    { name: '相对爆款', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'highlightReasons', operator: 'contains', value: '相对表现' } },
    { name: '绝对高点赞', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'highlightReasons', operator: 'contains', value: '绝对高点赞' } },
    { name: '钩子素材库', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'openingHook', operator: 'isNotEmpty' } },
    { name: '选题素材库', table: 'works', hiddenFieldKeys: ['accountType'], filter: { fieldKey: 'topicAngle', operator: 'isNotEmpty' } }
  ] satisfies FeishuViewDefinition[]
} as const
