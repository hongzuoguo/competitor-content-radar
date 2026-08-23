import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverviewPage } from '../../src/renderer/src/pages/OverviewPage'
import type { DashboardData } from '../../src/shared/ipc-contract'

const populated: DashboardData = {
  lastRunAt: '2026-07-11T01:12:00.000Z',
  creators: 6,
  newWorks: 12,
  analyzedWorks: 11,
  run: {
    runId: 'run-current',
    status: 'running',
    message: '正在拆解 1 条作品，暂时无需操作',
    requiresAction: false,
    stages: [
      { id: 'discovery', label: '采集', status: 'completed' },
      { id: 'download', label: '下载', status: 'completed' },
      { id: 'transcription', label: '转写', status: 'completed' },
      { id: 'analysis', label: 'AI 拆解', status: 'running' },
      { id: 'feishu', label: '飞书同步', status: 'pending' }
    ]
  },
  services: [
    { id: 'douyin', label: '抖音登录', status: 'healthy', detail: '会话有效' }
  ],
  weekly: { collectedWorks: 12, coveredCreators: 6, viralWorks: 1, viralRate: 8.3, highestLikes: 18_642, highestCreatorName: '增长实验室', highestRelativePerformanceMultiplier: 2.4 },
  topicRanking: [],
  topicRankingState: 'insufficient',
  topicRankingMessage: '本周爆款样本不足，至少 3 条后生成选题排行。',
  highlights: [
    {
      id: 'work-1',
      creatorName: '增长实验室',
      title: '为什么你的内容看起来很努力，却没有增长',
      firstCapturedAt: '2026-07-11T00:20:00.000Z', publishedAt: '2026-07-11T00:20:00.000Z',
      likes: 18_642,
      comments: 0, shares: 0, collects: 0,
      relativePerformanceMultiplier: 2.4,
      reasons: ['absolute_high_likes', 'relative_performance'], analysis: null,
      originalUrl: 'https://www.douyin.com/video/7658'
    }
  ]
}

describe('overview workspace', () => {
  it('places today focus before weekly key metrics', () => {
    render(<OverviewPage data={populated} />)

    const focus = screen.getByRole('region', { name: '今日重点' })
    const metrics = screen.getByLabelText('关键数据')
    expect(focus.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('groups the daily focus and KPI strip in one overview surface', () => {
    render(<OverviewPage data={populated} />)

    const snapshot = document.querySelector<HTMLElement>('.overview-snapshot')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.querySelector('.daily-focus')).not.toBeNull()
    expect(snapshot?.querySelector('.metric-strip')).not.toBeNull()
  })

  it('uses distinct work surfaces for rankings and topic insight', () => {
    render(<OverviewPage data={populated} />)

    expect(document.querySelector('.highlight-section.overview-work-surface')).not.toBeNull()
    expect(document.querySelector('.topic-ranking.overview-work-surface')).not.toBeNull()
  })

  it('switches the full Top 10 order and keeps today focus aligned with rank one', () => {
    const heatLeader = { ...populated.highlights[0], id: 'heat-leader', title: '热度榜首', radarStatus: 'newly_viral' as const, likes: 300, relativePerformanceMultiplier: 1.2 }
    const performanceLeader = { ...populated.highlights[0], id: 'performance-leader', title: '表现榜首', radarStatus: 'strong' as const, likes: 200, relativePerformanceMultiplier: 9.8 }
    render(<OverviewPage data={{ ...populated, highlights: [performanceLeader, heatLeader] }} />)

    const ranking = screen.getByRole('region', { name: '近 30 天爆款 · Top 10' })
    const focus = screen.getByRole('region', { name: '今日重点' })
    const group = within(ranking).getByRole('group', { name: 'Top 10 排序方式' })
    expect(within(group).getByRole('button', { name: '热度优先' })).toHaveAttribute('aria-pressed', 'true')
    expect(ranking.querySelector('.highlight-row strong')).toHaveTextContent('热度榜首')
    expect(focus).toHaveTextContent('热度榜首')

    fireEvent.click(within(group).getByRole('button', { name: '表现优先' }))
    expect(within(group).getByRole('button', { name: '表现优先' })).toHaveAttribute('aria-pressed', 'true')
    expect(ranking.querySelector('.highlight-row strong')).toHaveTextContent('表现榜首')
    expect(focus).toHaveTextContent('表现榜首')
    expect(screen.getByText(/已按相对表现排序，今日重点为表现榜首/)).toHaveClass('visually-hidden')
  })

  it('opens the inspector from today focus and restores focus to its trigger', () => {
    render(<OverviewPage data={populated} />)

    const trigger = within(screen.getByRole('region', { name: '今日重点' })).getByRole('button', { name: /为什么你的内容/ })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '爆款拆解' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(trigger).toHaveFocus()
  })

  it('shows an empty today focus without a work action when there are no highlights', () => {
    render(<OverviewPage data={{ ...populated, highlights: [] }} />)

    const focus = screen.getByRole('region', { name: '今日重点' })
    expect(focus).toHaveTextContent('近 30 天暂无爆款可作为今日重点。')
    expect(focus.querySelector('.daily-focus__action')).toBeNull()
  })

  it('sends users without creators directly to creator management', () => {
    window.location.hash = '#/'
    render(<OverviewPage data={{ ...populated, creators: 0, newWorks: 0, analyzedWorks: 0, highlights: [] }} />)
    expect(screen.getByRole('heading', { name: '还没有监控博主' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加第一个博主' }))
    expect(window.location.hash).toBe('#/creators')
  })

  it('shows operational metrics without the retired AI rating', () => {
    render(<OverviewPage data={populated} />)
    expect(screen.getByText('12', { selector: '.metric-strip__value' })).toBeInTheDocument()
    const metrics = screen.getByLabelText('作品关键指标')
    expect(metrics).toHaveTextContent('总点赞1.9万')
    expect(metrics).toHaveTextContent('相对表现2.4×')
    expect(metrics).not.toHaveTextContent('今日点赞')
    expect(metrics).not.toHaveTextContent('机会分')
    expect(screen.queryByText('AI 高借鉴')).not.toBeInTheDocument()
  })

  it('explains when local Codex is not ready instead of asking for a cloud model', () => {
    render(<OverviewPage data={{
      ...populated,
      topicRankingState: 'unconfigured',
      topicRankingMessage: '请先安装并登录 Codex，然后在设置中检测是否可用。'
    }} />)

    expect(screen.getByText('本地 Codex 未就绪')).toBeInTheDocument()
    expect(screen.getByText('请先安装并登录 Codex，然后在设置中检测是否可用。')).toBeInTheDocument()
    expect(screen.queryByText('尚未配置 AI')).not.toBeInTheDocument()
  })

  it('opens and closes the highlight inspector', () => {
    render(<OverviewPage data={populated} />)
    const highlights = screen.getByRole('region', { name: '近 30 天爆款 · Top 10' })
    fireEvent.click(within(highlights).getByRole('button', { name: /为什么你的内容/ }))
    expect(screen.getByRole('dialog', { name: '爆款拆解' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps run telemetry out of the editorial radar workspace', () => {
    render(<OverviewPage data={{ ...populated, run: { ...populated.run, failures: [{
      creatorId: 'creator-1', creatorName: '林克AI实战录', stage: 'discovery',
      code: 'DOUYIN_CREATOR_COLLECTION_FAILED', message: '博主作品采集失败，请稍后重试。',
      occurredAt: '2026-07-15T11:20:14.000Z'
    }] } }} />)
    expect(screen.getByRole('region', { name: '今日重点' })).toBeInTheDocument()
    expect(screen.queryByText(/正在拆解 1 条作品/)).not.toBeInTheDocument()
    expect(screen.queryByText('无需操作')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看失败详情' })).not.toBeInTheDocument()
  })
})
