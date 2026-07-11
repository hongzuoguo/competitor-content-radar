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
  highlights: [
    {
      id: 'work-1', creatorName: '增长实验室', title: '为什么你的内容看起来很努力，却没有增长',
      publishedAt: '2026-07-11T00:20:00.000Z', likes: 18642, relativeViralIndex: 238,
      referenceValueScore: 91, reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value'],
      summary: '反常识问题切入。', originalUrl: 'https://www.douyin.com/video/7658'
    }
  ]
} as DashboardData

describe('overview trust and interaction hardening', () => {
  it('places editorial decisions before detailed automation telemetry', () => {
    render(<OverviewPage data={data} />)
    const highlights = screen.getByRole('heading', { name: '今日重点' }).closest('section')!
    const runStatus = screen.getByRole('heading', { name: /今日监控/ }).closest('section')!
    expect(highlights.compareDocumentPosition(runStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows explicit units and published time in highlight rows', () => {
    render(<OverviewPage data={data} />)
    expect(screen.getByText('238%')).toBeInTheDocument()
    expect(screen.getByText('91/100')).toBeInTheDocument()
    expect(screen.getByText(/08:20/)).toBeInTheDocument()
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
    const trigger = screen.getByRole('button', { name: /为什么你的内容/ })
    trigger.focus()
    fireEvent.click(trigger)
    expect((document.querySelector('.app-shell') as HTMLElement & { inert: boolean }).inert).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(trigger).toHaveFocus()
  })

  it('shows service failures as actions instead of false-green health', () => {
    render(<OverviewPage data={data} />)
    expect(screen.getByText('余额不足')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去处理' })).toBeInTheDocument()
  })
})
