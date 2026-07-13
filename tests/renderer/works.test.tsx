import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import type { WorkListItem } from '../../src/shared/ipc-contract'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'

const completed: WorkListItem = {
  id: 'work-complete', creatorName: '增长实验室', title: '为什么你的内容看起来很努力，却没有增长',
  sourceType: 'douyin_monitor', publishedAt: '2026-07-13T08:20:00.000Z', status: 'completed', stage: 'completed',
  errorCode: null, errorMessage: null, retryable: false, likes: 18_642, relativeViralIndex: 238,
  referenceValueScore: 91, reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value']
}

const processing: WorkListItem = {
  id: 'work-running', creatorName: '未分类作品', title: '本地样片', sourceType: 'local_file',
  publishedAt: '2026-07-13T09:00:00.000Z', status: 'running', stage: 'transcribed', errorCode: null,
  errorMessage: null, retryable: false, likes: 0, relativeViralIndex: null, referenceValueScore: null, reasons: []
}

const failed: WorkListItem = {
  ...processing, id: 'work-failed', title: '失败样片', status: 'failed', stage: 'transcribed', errorCode: 'ANALYSIS_FAILED',
  errorMessage: 'AI 服务暂时不可用，请稍后重试。', retryable: true
}

let emitWorkChange: ((workId: string) => void) | undefined
let unsubscribe: ReturnType<typeof vi.fn>
let desktopApi: DesktopApi

function createDesktopApi(works: WorkListItem[] = [completed]): DesktopApi {
  unsubscribe = vi.fn()
  return {
    listWorks: vi.fn().mockResolvedValue(works),
    onWorkStateChanged: vi.fn((listener: (workId: string) => void) => { emitWorkChange = listener; return unsubscribe }),
    retryImport: vi.fn().mockResolvedValue({ accepted: true, workId: 'work-failed' }),
    listCreators: vi.fn().mockResolvedValue([]),
    pickLocalVideo: vi.fn().mockResolvedValue('C:\\video\\fallback.mp4'),
    getPathForFile: vi.fn(),
    startImport: vi.fn().mockResolvedValue({ accepted: true, workId: 'new-work' })
  } as unknown as DesktopApi
}

describe('work analysis library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitWorkChange = undefined
    desktopApi = createDesktopApi()
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: desktopApi })
  })

  it('shows loading skeletons and then a useful empty state', async () => {
    let resolveWorks!: (works: WorkListItem[]) => void
    desktopApi.listWorks = vi.fn().mockReturnValue(new Promise((resolve) => { resolveWorks = resolve }))
    render(<WorksPage />)
    expect(screen.getByRole('status', { name: '正在加载作品' })).toBeInTheDocument()
    resolveWorks([])
    expect(await screen.findByText('还没有作品')).toBeInTheDocument()
    expect(screen.getByText('导入本地视频或单条抖音作品，完成后会在这里显示拆解结果。')).toBeInTheDocument()
  })

  it('renders completed, processing and failed rows with stable stage labels', async () => {
    desktopApi.listWorks = vi.fn().mockResolvedValue([completed, processing, failed])
    render(<WorksPage />)
    expect(await screen.findByText('本地样片')).toBeInTheDocument()
    expect(screen.getByText('正在 AI 拆解')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '本地样片处理进度' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText('AI 拆解失败')).toBeInTheDocument()
    expect(screen.getByText(failed.errorMessage!)).toBeInTheDocument()
    expect(screen.getByText('18,642')).toBeInTheDocument()
  })

  it('retries only a retryable failed work and prevents duplicate clicks', async () => {
    desktopApi.listWorks = vi.fn().mockResolvedValue([failed])
    desktopApi.retryImport = vi.fn().mockReturnValue(new Promise(() => undefined))
    render(<WorksPage />)
    const retry = await screen.findByRole('button', { name: '重试失败样片' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(desktopApi.retryImport).toHaveBeenCalledTimes(1)
    expect(retry).toBeDisabled()
  })

  it('refreshes from work events, ignores stale requests, and unsubscribes on unmount', async () => {
    let resolveStale!: (works: WorkListItem[]) => void
    desktopApi.listWorks = vi.fn()
      .mockResolvedValueOnce([processing])
      .mockReturnValueOnce(new Promise((resolve) => { resolveStale = resolve }))
      .mockResolvedValueOnce([completed])
    const view = render(<WorksPage />)
    expect(await screen.findByText('本地样片')).toBeInTheDocument()
    emitWorkChange?.('work-running')
    emitWorkChange?.('work-running')
    expect(await screen.findByText(completed.title)).toBeInTheDocument()
    resolveStale([failed])
    await waitFor(() => expect(screen.queryByText('失败样片')).not.toBeInTheDocument())
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    emitWorkChange?.('work-running')
    expect(desktopApi.listWorks).toHaveBeenCalledTimes(3)
  })

  it('preserves highlight filters and adds processing and failed filters', async () => {
    desktopApi.listWorks = vi.fn().mockResolvedValue([completed, processing, failed])
    render(<WorksPage />)
    await screen.findByText(completed.title)
    fireEvent.click(screen.getByRole('button', { name: '处理中' }))
    expect(screen.getByText('本地样片')).toBeInTheDocument()
    expect(screen.queryByText(completed.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '失败' }))
    expect(screen.getByText('失败样片')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '只看高点赞' }))
    expect(screen.getByText(completed.title)).toBeInTheDocument()
    expect(screen.queryByText('本地样片')).not.toBeInTheDocument()
  })

  it('focuses the original work when a duplicate converges asynchronously', async () => {
    const duplicate = { ...failed, id: 'duplicate-job', title: '重复样片', errorCode: 'IMPORT_DUPLICATE', retryable: false, existingWorkId: completed.id }
    desktopApi.listWorks = vi.fn().mockResolvedValue([duplicate, completed])
    render(<WorksPage />)
    expect(await screen.findByText('已存在相同作品，已为你定位到原作品。')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: new RegExp(completed.title) })).toHaveFocus()
    const search = screen.getByRole('textbox', { name: '搜索作品' })
    search.focus()
    emitWorkChange?.('another-work')
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(2))
    expect(search).toHaveFocus()
  })

  it('offers local upload after Douyin download is unavailable and keeps the creator', async () => {
    const unavailable = { ...failed, id: 'unavailable', creatorName: '测试博主', sourceType: 'douyin_url' as const, errorCode: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', retryable: false }
    desktopApi.listWorks = vi.fn().mockResolvedValue([unavailable])
    desktopApi.listCreators = vi.fn().mockResolvedValue([{ id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test', enabled: true, works: 1, lastRun: '刚刚', status: 'ready' }])
    render(<WorksPage />)
    fireEvent.click(await screen.findByRole('button', { name: '改为上传本地视频' }))
    expect(await screen.findByRole('dialog', { name: '导入作品' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本地视频' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByLabelText('关联博主（可选）')).toHaveValue('creator-1'))
  })

  it('refreshes and announces when an import is accepted', async () => {
    desktopApi.listWorks = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([processing])
    render(<WorksPage />)
    await screen.findByText('还没有作品')
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect(await screen.findByText(/任务已启动/)).toBeInTheDocument()
    expect(await screen.findByText('本地样片')).toBeInTheDocument()
  })
})
