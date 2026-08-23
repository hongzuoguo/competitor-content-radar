import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../../src/renderer/src/components/AppShell'
import { OverviewPage } from '../../src/renderer/src/pages/OverviewPage'
import type { DashboardData } from '../../src/shared/ipc-contract'

const data = {
  lastRunAt: '2026-07-11T01:12:00.000Z',
  nextRunAt: '2026-07-12T01:00:00.000Z',
  creators: 6,
  newWorks: 12,
  analyzedWorks: 11,
  run: {
    runId: 'run-current',
    status: 'running',
    message: '正在拆解最后 1 条作品，预计 1 分钟内完成',
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
    { id: 'douyin', label: '抖音登录', status: 'healthy', detail: '会话有效' },
    { id: 'ai', label: 'AI 拆解', status: 'action_required', detail: '余额不足', actionLabel: '去处理' }
  ],
  weekly: { collectedWorks: 12, coveredCreators: 6, viralWorks: 1, viralRate: 8.3, highestLikes: 18642, highestCreatorName: '增长实验室', highestRelativePerformanceMultiplier: 2.4 },
  topicRanking: [{
    topic: 'AI工具测评与推荐', viralWorks: 2, totalLikes: 30_000,
    workIds: ['work-1'], newThisWeek: 1, previousWeekNew: 0, weekOverWeekDelta: 1,
    representativeWorkId: 'work-1', representativeTitle: '为什么你的内容看起来很努力，却没有增长'
  }],
  topicRankingState: 'ready',
  topicRankingMessage: '',
  highlights: [
    {
      id: 'work-1', creatorName: '增长实验室', title: '为什么你的内容看起来很努力，却没有增长',
      firstCapturedAt: '2026-07-11T00:20:00.000Z', publishedAt: '2026-07-11T00:20:00.000Z', likes: 18642,
      comments: 0, shares: 0, collects: 0, relativePerformanceMultiplier: 2.4,
      radarStatus: 'strong', radarEvidence: [], firstBecameViralAt: '2026-07-11T00:20:00.000Z',
      reasons: ['absolute_high_likes', 'relative_performance'], analysis: null, originalUrl: 'https://www.douyin.com/video/7658'
    }
  ]
} as DashboardData

describe('overview trust and interaction hardening', () => {
  it('places the viral ranking before topic insights', () => {
    render(<OverviewPage data={data} />)
    const highlights = screen.getByRole('heading', { name: '近 30 天爆款 · Top 10' }).closest('section')!
    const topics = screen.getByRole('heading', { name: '选题洞察' }).closest('section')!
    expect(highlights.compareDocumentPosition(topics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows explicit metrics in highlight rows', () => {
    render(<OverviewPage data={data} />)
    const metrics = screen.getByLabelText('作品关键指标')
    expect(metrics).toHaveTextContent('1.9万')
    expect(metrics).toHaveTextContent('2.4×')
  })

  it('keeps highlight status and topic changes on their respective title lines', () => {
    render(<OverviewPage data={data} />)

    const highlightRow = document.querySelector<HTMLButtonElement>('.highlight-row')!
    const highlightTitleLine = highlightRow.querySelector('.highlight-row__title-line')
    expect(highlightTitleLine).toHaveTextContent('为什么你的内容看起来很努力，却没有增长')
    expect(highlightTitleLine).toHaveTextContent('高位稳定')
    expect(highlightTitleLine).not.toHaveTextContent('增长实验室')

    const topicRow = screen.getByRole('button', { name: /AI工具测评与推荐/ })
    const topicTitleLine = topicRow.querySelector('.topic-ranking__title-line')
    expect(topicTitleLine).toHaveTextContent('AI工具测评与推荐')
    expect(topicTitleLine).toHaveTextContent('2 条爆款')
    expect(topicTitleLine).toHaveTextContent('本周新晋 1 条')
    expect(topicTitleLine).toHaveTextContent('较上周 +1')
  })

  it('refreshes with a loading state and announces completion', async () => {
    const onRefresh = vi.fn().mockResolvedValue({ ...data, analyzedWorks: 12 })
    render(<OverviewPage data={data} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }))
    expect(screen.getByRole('button', { name: '刷新中' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText('数据已更新')).toBeInTheDocument())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('makes the background inert and restores focus to the triggering row', () => {
    render(<MemoryRouter><AppShell><OverviewPage data={data} /></AppShell></MemoryRouter>)
    const trigger = document.querySelector<HTMLButtonElement>('.highlight-row')!
    trigger.focus()
    fireEvent.click(trigger)
    expect((document.querySelector('.app-shell') as HTMLElement & { inert: boolean }).inert).toBe(true)
    const closeButton = document.querySelector<HTMLButtonElement>('.inspector__header button')!
    const lastAction = document.querySelector<HTMLButtonElement>('.inspector__footer button')!
    lastAction.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(closeButton).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(trigger).toHaveFocus()
  })

  it('contains topic inspector focus and restores the topic trigger on Escape', () => {
    render(<MemoryRouter><AppShell><OverviewPage data={data} /></AppShell></MemoryRouter>)
    const trigger = document.querySelector<HTMLButtonElement>('.topic-ranking__list button')!
    trigger.focus()
    fireEvent.click(trigger)

    expect((document.querySelector('.app-shell') as HTMLElement & { inert: boolean }).inert).toBe(true)
    const closeButton = document.querySelector<HTMLButtonElement>('.inspector__header button')!
    const workButton = document.querySelector<HTMLButtonElement>('.topic-works button')!
    workButton.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(closeButton).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(workButton).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps service remediation out of the editorial radar workspace', () => {
    render(<OverviewPage data={data} />)
    expect(screen.queryByText('余额不足')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '去处理' })).not.toBeInTheDocument()
  })
})
