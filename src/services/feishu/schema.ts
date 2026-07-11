export type FeishuFieldType = 'text' | 'number' | 'date' | 'url' | 'checkbox' | 'link'

export interface FeishuFieldDefinition {
  name: string
  type: FeishuFieldType
  linkTo?: 'creators' | 'works' | 'reports'
}

export interface FeishuTableDefinition {
  key: 'creators' | 'works' | 'snapshots' | 'reports'
  name: string
  fields: FeishuFieldDefinition[]
}

export const FEISHU_BASE_SCHEMA = {
  name: '对标内容雷达',
  tables: [
    {
      key: 'creators',
      name: '博主',
      fields: [
        { name: '博主ID', type: 'text' },
        { name: '博主名称', type: 'text' },
        { name: '主页地址', type: 'url' },
        { name: '是否监控', type: 'checkbox' },
        { name: '最后采集时间', type: 'date' }
      ]
    },
    {
      key: 'works',
      name: '作品分析',
      fields: [
        { name: '作品ID', type: 'text' },
        { name: '博主', type: 'link', linkTo: 'creators' },
        { name: '标题', type: 'text' },
        { name: '发布时间', type: 'date' },
        { name: '原视频', type: 'url' },
        { name: '点赞量', type: 'number' },
        { name: '评论量', type: 'number' },
        { name: '分享量', type: 'number' },
        { name: '收藏量', type: 'number' },
        { name: '相对爆款指数', type: 'number' },
        { name: '借鉴价值评分', type: 'number' },
        { name: '入选原因', type: 'text' },
        { name: '选题角度', type: 'text' },
        { name: '开头钩子', type: 'text' },
        { name: '内容结构', type: 'text' },
        { name: '视频爆点', type: 'text' },
        { name: '互动引导', type: 'text' },
        { name: '亮点内容', type: 'text' },
        { name: '可复用模式', type: 'text' },
        { name: '差异化创作建议', type: 'text' },
        { name: '完整文案', type: 'text' },
        { name: 'AI提供商', type: 'text' },
        { name: '模型ID', type: 'text' },
        { name: '提示词版本', type: 'text' }
      ]
    },
    {
      key: 'snapshots',
      name: '每日指标快照',
      fields: [
        { name: '快照ID', type: 'text' },
        { name: '作品', type: 'link', linkTo: 'works' },
        { name: '采集时间', type: 'date' },
        { name: '点赞量', type: 'number' },
        { name: '评论量', type: 'number' },
        { name: '分享量', type: 'number' },
        { name: '收藏量', type: 'number' }
      ]
    },
    {
      key: 'reports',
      name: '报告',
      fields: [
        { name: '报告ID', type: 'text' },
        { name: '类型', type: 'text' },
        { name: '统计周期', type: 'text' },
        { name: '新增作品数', type: 'number' },
        { name: '今日重点数', type: 'number' },
        { name: '报告正文', type: 'text' },
        { name: '生成时间', type: 'date' }
      ]
    }
  ] satisfies FeishuTableDefinition[],
  views: [
    { name: '今日新增', table: 'works' },
    { name: '相对爆款', table: 'works' },
    { name: '绝对高点赞', table: 'works' },
    { name: '高借鉴价值', table: 'works' },
    { name: '钩子素材库', table: 'works' },
    { name: '选题素材库', table: 'works' }
  ]
} as const
