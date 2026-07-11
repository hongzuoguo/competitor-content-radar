import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverviewPage } from '../../src/renderer/src/pages/OverviewPage'
import type { DashboardData } from '../../src/shared/ipc-contract'

const populated: DashboardData = {
  lastRunAt: '2026-07-11T01:12:00.000Z',
  nextRunAt: '2026-07-12T01:00:00.000Z',
  creators: 6,
  newWorks: 12,
  analyzedWorks: 11,
  highlights: [
    {
      id: 'work-1',
      creatorName: '增长实验室',
      title: '为什么你的内容看起来很努力，却没有增长',
      publishedAt: '2026-07-11T00:20:00.000Z',
      likes: 18_642,
      relativeViralIndex: 238,
      referenceValueScore: 91,
      reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value'],
      summary: '用反常识问题切入，再用三个具体错误完成自检式结构。',
      originalUrl: 'https://www.douyin.com/video/7658'
    }
  ]
}

describe('overview workspace', () => {
  it('shows the educational empty state without creators', () => {
    render(<OverviewPage data={{ ...populated, creators: 0, newWorks: 0, analyzedWorks: 0, highlights: [] }} />)
    expect(screen.getByRole('heading', { name: '还没有监控博主' })).toBeInTheDocument()
  })

  it('shows operational metrics and highlight reasons', () => {
    render(<OverviewPage data={populated} />)
    expect(screen.getByText('12', { selector: '.metric-strip__value' })).toBeInTheDocument()
    expect(screen.getByText('高点赞')).toBeInTheDocument()
    expect(screen.getByText('相对爆款')).toBeInTheDocument()
    expect(screen.getByText('AI 高借鉴')).toBeInTheDocument()
  })

  it('opens and closes the highlight inspector', () => {
    render(<OverviewPage data={populated} />)
    fireEvent.click(screen.getByRole('button', { name: /为什么你的内容/ }))
    expect(screen.getByRole('dialog', { name: '作品拆解摘要' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('makes partial processing visible instead of claiming full success', () => {
    render(<OverviewPage data={populated} />)
    expect(screen.getByText('1 条待处理')).toBeInTheDocument()
  })
})
