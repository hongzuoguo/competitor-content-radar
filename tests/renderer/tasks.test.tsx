import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import type { DashboardData, RunHistoryItem } from '../../src/shared/ipc-contract'
import { TasksPage } from '../../src/renderer/src/pages/TasksPage'

function dashboard(status: DashboardData['run']['status']): DashboardData {
  return {
    lastRunAt: status === 'running' ? null : '2026-07-19T00:00:00.000Z',
    creators: 1,
    newWorks: 0,
    analyzedWorks: 0,
    run: {
      runId: status === 'idle' ? null : 'run-current',
      status,
      message: status === 'running' ? '正在采集公开作品' : '本次采集已完成',
      requiresAction: false,
      stages: [{ id: 'discovery', label: '采集', status: status === 'running' ? 'running' : 'completed' }]
    },
    services: [],
    weekly: { collectedWorks: 0 },
    highlights: [],
    topicRanking: [],
    topicRankingState: 'insufficient',
    topicRankingMessage: ''
  }
}

const completedRun: RunHistoryItem = {
  id: 'run-completed', kind: 'manual', status: 'completed',
  startedAt: '2026-07-19T00:00:00.000Z', finishedAt: '2026-07-19T00:01:00.000Z',
  discovered: 1, selectedForAnalysis: 0, analyzed: 0, failures: []
}

describe('task history', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: {
      listRuns: vi.fn().mockResolvedValue([{
        id: 'run-1', kind: 'manual', status: 'partial',
        startedAt: '2026-07-15T11:20:14.000Z', finishedAt: '2026-07-15T11:20:15.000Z',
        discovered: 4, selectedForAnalysis: 2, analyzed: 1, failures: [{
          creatorId: 'creator-1', creatorName: '林克AI实战录', stage: 'discovery',
          code: 'SCRAPLING_ENGINE_INTERNAL', message: 'SCRAPLING_ENGINE_INTERNAL',
          occurredAt: '2026-07-15T11:20:14.000Z'
        }]
      }]),
      getDashboard: vi.fn().mockResolvedValue(dashboard('partial')),
      retryRun: vi.fn().mockResolvedValue({ accepted: true }),
      retryFailedCreators: vi.fn().mockResolvedValue({ accepted: true })
    } as unknown as DesktopApi })
  })

  it('loads real failures, opens their details and retries the run', async () => {
    const shell = document.createElement('div')
    shell.className = 'app-shell'
    document.body.append(shell)
    const { unmount } = render(<TasksPage />, { container: shell })

    const trigger = await screen.findByRole('button', { name: /查看失败详情/ })
    expect(trigger).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('发现 2 条爆款，已拆解 1 条')).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '失败详情' })).toBeInTheDocument()
    expect(shell.inert).toBe(true)
    expect(shell.contains(screen.getByRole('dialog', { name: '失败详情' }))).toBe(false)
    expect(screen.getByRole('button', { name: '关闭失败详情' })).toHaveFocus()
    expect(screen.getByText('SCRAPLING_ENGINE_INTERNAL')).toBeInTheDocument()
    expect(screen.getByText('采集组件运行异常。请先点击「重试采集」；如果仍然失败，请重启应用并重新登录抖音后再试。连续失败时，请复制错误信息反馈给开发者。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重采所选博主' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '林克AI实战录' }))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))
    await waitFor(() => expect(window.desktopApi.retryFailedCreators).toHaveBeenCalledWith({ runId: 'run-1', creatorIds: ['creator-1'] }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(window.desktopApi.retryRun).not.toHaveBeenCalled()
    unmount()
    shell.remove()
  })

  it('groups current run status and history into two explicit workspace surfaces', async () => {
    const { container } = render(<TasksPage />)

    await waitFor(() => expect(container.querySelector('.task-row')).toBeInTheDocument())
    expect(container.querySelector('.task-status-surface')).toBeInTheDocument()
    expect(container.querySelector('.task-history-surface')).toBeInTheDocument()
  })

  it('shows every failure, deduplicates retryable creators and preserves selection when rejected', async () => {
    const failures = [
      { creatorId: 'creator-a', creatorName: '博主 A', stage: 'discovery' as const, code: 'DOUYIN_CREATOR_COLLECTION_FAILED', message: 'raw', occurredAt: '2026-08-13T00:00:00.000Z' },
      { creatorId: 'creator-a', creatorName: '博主 A', stage: 'discovery' as const, code: 'DOUYIN_CREATOR_COLLECTION_FAILED', message: 'raw', occurredAt: '2026-08-13T00:00:01.000Z' },
      { creatorId: 'creator-b', creatorName: '博主 B', stage: 'discovery' as const, code: 'DOUYIN_CREATOR_COLLECTION_FAILED', message: 'raw', occurredAt: '2026-08-13T00:00:02.000Z' },
      { creatorId: null, creatorName: '本次运行', stage: 'analysis' as const, code: 'Bearer secret C:\\private stack', message: 'stderr raw', occurredAt: 'C:\\private\\time' }
    ]
    const run = { id: 'run-multi', kind: 'manual' as const, status: 'partial' as const, startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z', discovered: 0, selectedForAnalysis: 0, analyzed: 0, failures }
    vi.mocked(window.desktopApi.listRuns).mockResolvedValue([run])
    vi.mocked(window.desktopApi.retryFailedCreators).mockResolvedValue({ accepted: false, reason: '所选博主已变化，请刷新失败详情后重试' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<TasksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    expect(screen.getByText('共 4 个失败项，其中 2 位博主可重新采集')).toBeInTheDocument()
    expect(screen.getAllByText('博主作品采集失败，请稍后重试。')).toHaveLength(3)
    expect(screen.getByText('UNKNOWN_FAILURE')).toBeInTheDocument()
    expect(screen.getByText('时间未知')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Bearer secret|private stack|stderr raw/)
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0][0]).not.toMatch(/Bearer secret|private|stderr raw/)
    fireEvent.click(screen.getByRole('checkbox', { name: '博主 A' }))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('所选博主已变化')
    expect(screen.getByRole('checkbox', { name: '博主 A' })).toBeChecked()
  })

  it('keeps a pending retry modal locked and contains clipboard failures', async () => {
    let resolveRetry!: (value: { accepted: boolean }) => void
    vi.mocked(window.desktopApi.retryFailedCreators).mockReturnValue(new Promise((resolve) => { resolveRetry = resolve }))
    const writeText = vi.fn().mockRejectedValue(new Error('Bearer secret clipboard failure'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<TasksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败，请稍后重试。')
    expect(document.body.textContent).not.toMatch(/Bearer secret|clipboard failure/)

    fireEvent.click(screen.getByRole('checkbox', { name: '林克AI实战录' }))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))
    expect(screen.getByRole('button', { name: '关闭失败详情' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '点击背景关闭失败详情' }))
    expect(screen.getByRole('dialog', { name: '失败详情' })).toBeInTheDocument()

    resolveRetry({ accepted: true })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '失败详情' })).not.toBeInTheDocument())
  })

  it('closes after an accepted retry even when refreshing the task history fails', async () => {
    render(<TasksPage />)
    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: '林克AI实战录' }))
    vi.mocked(window.desktopApi.listRuns).mockRejectedValueOnce(new Error('refresh failed'))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '失败详情' })).not.toBeInTheDocument())
    expect(window.desktopApi.retryFailedCreators).toHaveBeenCalledTimes(1)
  })

  it('uses legacy retry only for a pure Feishu failure', async () => {
    vi.mocked(window.desktopApi.listRuns).mockResolvedValue([{
      id: 'run-feishu', kind: 'manual', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      discovered: 1, selectedForAnalysis: 0, analyzed: 0,
      failures: [{ creatorId: null, creatorName: '飞书同步', stage: 'feishu', code: 'FEISHU_SYNC_FAILED', message: 'raw', occurredAt: '2026-08-13T00:01:00.000Z' }]
    }])
    render(<TasksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    expect(screen.getByRole('button', { name: '重新同步飞书' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重采所选博主' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新同步飞书' }))
    await waitFor(() => expect(window.desktopApi.retryRun).toHaveBeenCalledWith('run-feishu'))
    expect(window.desktopApi.retryFailedCreators).not.toHaveBeenCalled()
  })

  it('offers only targeted creator retry for mixed discovery and Feishu failures', async () => {
    vi.mocked(window.desktopApi.listRuns).mockResolvedValue([{
      id: 'run-mixed', kind: 'manual', status: 'partial', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:01:00.000Z',
      discovered: 0, selectedForAnalysis: 0, analyzed: 0,
      failures: [
        { creatorId: 'creator-mixed', creatorName: '混合失败博主', stage: 'discovery', code: 'DOUYIN_CREATOR_COLLECTION_FAILED', message: 'raw', occurredAt: '2026-08-13T00:00:30.000Z' },
        { creatorId: null, creatorName: '飞书同步', stage: 'feishu', code: 'FEISHU_SYNC_FAILED', message: 'raw', occurredAt: '2026-08-13T00:01:00.000Z' }
      ]
    }])
    render(<TasksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    expect(screen.getByText('飞书同步问题请到设置页检查连接；此处只重新采集所选博主。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重采所选博主' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '重新同步飞书' })).not.toBeInTheDocument()
    expect(window.desktopApi.retryRun).not.toHaveBeenCalled()
  })

  it('does not leave an empty service column when no runtime services are available', async () => {
    const { container } = render(<TasksPage />)

    await waitFor(() => expect(container.querySelector('.task-status-surface')).toBeInTheDocument())
    expect(container.querySelector('.task-health')).not.toBeInTheDocument()
  })

  it('refreshes the dashboard and history while a collection is running', async () => {
    vi.useFakeTimers()
    const getDashboard = vi.fn()
      .mockResolvedValueOnce(dashboard('running'))
      .mockResolvedValueOnce(dashboard('completed'))
    const listRuns = vi.fn().mockResolvedValue([completedRun])
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: {
      getDashboard,
      listRuns,
      retryRun: vi.fn().mockResolvedValue({ accepted: true })
    } as unknown as DesktopApi })

    render(<TasksPage />)

    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: '今日监控进行中' })).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('heading', { name: '今日监控已完成' })).toBeInTheDocument()
    expect(screen.getByText('采集完成')).toBeInTheDocument()
    expect(getDashboard).toHaveBeenCalledTimes(2)
    expect(listRuns).toHaveBeenCalledTimes(2)
  })

  it('refreshes when a run starts while the task page is already open', async () => {
    vi.useFakeTimers()
    const runningRun: RunHistoryItem = { ...completedRun, status: 'running', finishedAt: null }
    const getDashboard = vi.fn()
      .mockResolvedValueOnce(dashboard('completed'))
      .mockResolvedValueOnce(dashboard('running'))
      .mockResolvedValueOnce(dashboard('completed'))
    const listRuns = vi.fn()
      .mockResolvedValueOnce([completedRun])
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([completedRun])
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: {
      getDashboard,
      listRuns,
      retryRun: vi.fn().mockResolvedValue({ accepted: true })
    } as unknown as DesktopApi })

    render(<TasksPage />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: '今日监控已完成' })).toBeInTheDocument()

    await act(async () => { window.dispatchEvent(new Event('content-radar:run-started')); await Promise.resolve() })
    expect(screen.getByRole('heading', { name: '今日监控进行中' })).toBeInTheDocument()
    expect(screen.getByText('采集中')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('heading', { name: '今日监控已完成' })).toBeInTheDocument()
    expect(screen.getByText('采集完成')).toBeInTheDocument()
  })
})
