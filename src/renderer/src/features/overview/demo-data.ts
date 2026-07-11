import type { DashboardData } from '../../../../shared/ipc-contract'

export const OVERVIEW_DEMO_DATA: DashboardData = {
  lastRunAt: '2026-07-11T01:12:00.000Z',
  nextRunAt: '2026-07-12T01:00:00.000Z',
  creators: 6,
  newWorks: 12,
  analyzedWorks: 11,
  highlights: [
    {
      id: 'preview-1',
      creatorName: '增长实验室',
      title: '为什么你的内容看起来很努力，却没有增长',
      publishedAt: '2026-07-11T00:20:00.000Z',
      likes: 18_642,
      relativeViralIndex: 238,
      referenceValueScore: 91,
      reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value'],
      summary: '用反常识问题切入，再用三个具体错误完成自检式结构。开头承诺清晰，信息密度高，适合迁移到知识类账号。',
      originalUrl: 'https://www.douyin.com/video/7658'
    },
    {
      id: 'preview-2',
      creatorName: '内容操盘手阿哲',
      title: '一个选题能不能爆，发布前看这三个信号',
      publishedAt: '2026-07-10T23:40:00.000Z',
      likes: 8_930,
      relativeViralIndex: 176,
      referenceValueScore: 88,
      reasons: ['relative_viral', 'high_reference_value'],
      summary: '把抽象的选题判断压缩成三个检查动作，适合做成系列化内容模板。',
      originalUrl: 'https://www.douyin.com/video/7659'
    },
    {
      id: 'preview-3',
      creatorName: '短视频观察局',
      title: '别急着追热点，先判断它和你的用户有没有关系',
      publishedAt: '2026-07-10T21:10:00.000Z',
      likes: 12_706,
      relativeViralIndex: 132,
      referenceValueScore: 84,
      reasons: ['absolute_high_likes', 'high_reference_value'],
      summary: '以热点误区制造冲突，再用用户需求矩阵完成筛选，观点鲜明且风险提示充分。',
      originalUrl: 'https://www.douyin.com/video/7660'
    }
  ]
}
