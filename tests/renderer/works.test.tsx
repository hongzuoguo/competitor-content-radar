import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import type { WorkListItem } from '../../src/shared/ipc-contract'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'
import { stableWorkErrorMessage } from '../../src/renderer/src/features/works/WorkStatusRow'

const completed: WorkListItem = {
  id: 'work-complete', creatorId: 'creator-complete', creatorName: '增长实验室', title: '为什么你的内容看起来很努力，却没有增长',
  sourceType: 'douyin_monitor', publishedAt: '2026-07-13T08:20:00.000Z', status: 'completed', stage: 'completed',
  errorCode: null, errorMessage: null, retryable: false, likes: 18_642, relativeViralIndex: 238,
  referenceValueScore: 91, reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value']
}

const processing: WorkListItem = {
  id: 'work-running', creatorId: null, creatorName: '未分类作品', title: '本地样片', sourceType: 'local_file',
  publishedAt: '2026-07-13T09:00:00.000Z', status: 'running', stage: 'transcribed', errorCode: null,
  errorMessage: null, retryable: false, likes: 0, relativeViralIndex: null, referenceValueScore: null, reasons: []
}

const failed: WorkListItem = {
  ...processing, id: 'work-failed', title: '失败样片', status: 'failed', stage: 'transcribed', errorCode: 'ANALYSIS_FAILED',
  errorMessage: 'Import processing failed.', retryable: true
}

let emitWorkChange: ((workId: string) => void) | undefined
let unsubscribe: ReturnType<typeof vi.fn>
let desktopApi: DesktopApi

function controlAnimationFrames(): { flushAll(): void; pending(): number } {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId
    nextId += 1
    callbacks.set(id, callback)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id)
  })
  return {
    flushAll(): void {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(0))
    },
    pending: () => callbacks.size
  }
}

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

  afterEach(() => {
    vi.restoreAllMocks()
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
    expect(screen.getByText('AI 服务暂时不可用，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText('Import processing failed.')).not.toBeInTheDocument()
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

  it('coalesces burst events into one trailing refresh and ends on the newest state', async () => {
    let resolveStale!: (works: WorkListItem[]) => void
    desktopApi.listWorks = vi.fn()
      .mockResolvedValueOnce([processing])
      .mockReturnValueOnce(new Promise((resolve) => { resolveStale = resolve }))
      .mockResolvedValueOnce([completed])
    const view = render(<WorksPage />)
    expect(await screen.findByText('本地样片')).toBeInTheDocument()
    for (let index = 0; index < 20; index += 1) emitWorkChange?.('work-running')
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(2))
    resolveStale([failed])
    expect(await screen.findByText(completed.title)).toBeInTheDocument()
    expect(desktopApi.listWorks).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('失败样片')).not.toBeInTheDocument()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    emitWorkChange?.('work-running')
    expect(desktopApi.listWorks).toHaveBeenCalledTimes(3)
  })

  it('keeps the last successful list when a background refresh fails', async () => {
    desktopApi.listWorks = vi.fn().mockResolvedValueOnce([completed]).mockRejectedValueOnce(new Error('database busy'))
    render(<WorksPage />)
    expect(await screen.findByText(completed.title)).toBeInTheDocument()
    emitWorkChange?.(completed.id)
    expect(await screen.findByText('作品刷新失败，已保留上次结果。')).toBeInTheDocument()
    expect(screen.getByText(completed.title)).toBeInTheDocument()
    expect(screen.queryByText('作品加载失败')).not.toBeInTheDocument()
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

  it('ignores historical duplicates on initial loads and unrelated events', async () => {
    const historical = { ...failed, id: 'historical-duplicate', title: '历史重复', errorCode: 'IMPORT_DUPLICATE', retryable: false, existingWorkId: completed.id }
    desktopApi.listWorks = vi.fn().mockResolvedValue([historical, completed])
    render(<WorksPage />)
    await screen.findByText(completed.title)
    fireEvent.click(screen.getByRole('button', { name: '只看高点赞' }))
    const search = screen.getByRole('textbox', { name: '搜索作品' })
    fireEvent.change(search, { target: { value: '增长' } })
    search.focus()
    emitWorkChange?.('another-work')
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(2))
    expect(search).toHaveFocus()
    expect(search).toHaveValue('增长')
    expect(screen.getByRole('button', { name: '只看高点赞' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('已存在相同作品，已为你定位到原作品。')).not.toBeInTheDocument()
  })

  it('keeps duplicate focus authoritative when duplicate resolves before focus restoration', async () => {
    const frames = controlAnimationFrames()
    const pending = { ...processing, id: 'pending-import', title: '待确认样片' }
    const duplicate = { ...failed, id: pending.id, title: pending.title, errorCode: 'IMPORT_DUPLICATE', retryable: false, existingWorkId: completed.id }
    desktopApi.startImport = vi.fn().mockResolvedValue({ accepted: true, workId: pending.id })
    desktopApi.listWorks = vi.fn()
      .mockResolvedValueOnce([completed])
      .mockResolvedValueOnce([pending, completed])
      .mockResolvedValue([duplicate, completed])
    render(<WorksPage />)
    await screen.findByText(completed.title)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(2))
    emitWorkChange?.('another-work')
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('已存在相同作品，已为你定位到原作品。')).not.toBeInTheDocument()
    emitWorkChange?.(pending.id)
    expect(await screen.findByText('已存在相同作品，已为你定位到原作品。')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: new RegExp(completed.title) })).toHaveFocus()
    expect(frames.pending()).toBe(0)
    frames.flushAll()
    expect(screen.getByRole('row', { name: new RegExp(completed.title) })).toHaveFocus()
    const search = screen.getByRole('textbox', { name: '搜索作品' })
    search.focus()
    emitWorkChange?.(pending.id)
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(5))
    expect(search).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '处理中' }))
    search.focus()
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText(completed.title)).toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('moves focus from the import button to a duplicate resolved after restoration', async () => {
    const frames = controlAnimationFrames()
    let resolveDuplicate!: (works: WorkListItem[]) => void
    const duplicate = { ...failed, id: 'pending-import', title: '重复作品', errorCode: 'IMPORT_DUPLICATE', retryable: false, existingWorkId: completed.id }
    desktopApi.startImport = vi.fn().mockResolvedValue({ accepted: true, workId: duplicate.id })
    desktopApi.listWorks = vi.fn()
      .mockResolvedValueOnce([completed])
      .mockReturnValueOnce(new Promise((resolve) => { resolveDuplicate = resolve }))
    render(<WorksPage />)
    await screen.findByText(completed.title)
    const trigger = screen.getByRole('button', { name: '导入作品' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(desktopApi.listWorks).toHaveBeenCalledTimes(2))
    expect(frames.pending()).toBe(1)
    frames.flushAll()
    expect(trigger).toHaveFocus()
    resolveDuplicate([duplicate, completed])
    expect(await screen.findByText('已存在相同作品，已为你定位到原作品。')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: new RegExp(completed.title) })).toHaveFocus()
  })

  it('shows only the primary empty state when storage contains duplicate placeholders', async () => {
    const historical = { ...failed, id: 'historical-duplicate', errorCode: 'IMPORT_DUPLICATE', retryable: false, existingWorkId: 'deleted-original' }
    desktopApi.listWorks = vi.fn().mockResolvedValue([historical])
    render(<WorksPage />)
    expect(await screen.findByText('还没有作品')).toBeInTheDocument()
    expect(screen.queryByText('没有符合条件的作品')).not.toBeInTheDocument()
  })

  it('does not open local fallback when file selection is cancelled', async () => {
    const unavailable = { ...failed, id: 'unavailable', creatorId: 'creator-1', creatorName: '测试博主', sourceType: 'douyin_url' as const, errorCode: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', retryable: false }
    desktopApi.listWorks = vi.fn().mockResolvedValue([unavailable])
    desktopApi.pickLocalVideo = vi.fn().mockResolvedValue(null)
    render(<WorksPage />)
    fireEvent.click(await screen.findByRole('button', { name: '改为上传本地视频' }))
    await waitFor(() => expect(desktopApi.pickLocalVideo).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: '导入作品' })).not.toBeInTheDocument()
  })

  it('treats the real missing-media code as the same local-upload recovery', async () => {
    const unavailable = { ...failed, id: 'unavailable', creatorId: 'creator-1', creatorName: '重复名称', sourceType: 'douyin_url' as const, errorCode: 'DOUYIN_MEDIA_URL_MISSING', retryable: false }
    desktopApi.listWorks = vi.fn().mockResolvedValue([unavailable])
    desktopApi.listCreators = vi.fn().mockResolvedValue([
      { id: 'creator-other', name: '重复名称', profileUrl: 'https://www.douyin.com/user/other', enabled: true, works: 1, lastRun: '刚刚', status: 'ready' },
      { id: 'creator-1', name: '重复名称', profileUrl: 'https://www.douyin.com/user/test', enabled: true, works: 1, lastRun: '刚刚', status: 'ready' }
    ])
    render(<WorksPage />)
    fireEvent.click(await screen.findByRole('button', { name: '改为上传本地视频' }))
    await waitFor(() => expect(desktopApi.pickLocalVideo).toHaveBeenCalledOnce())
    expect(await screen.findByRole('dialog', { name: '导入作品' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本地视频' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('fallback.mp4')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('关联博主（可选）')).toHaveValue('creator-1'))
  })

  it.each([
    ['DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', 'discovered', '无法从该抖音作品获取可下载视频，请改为上传本地视频。'],
    ['DOUYIN_MEDIA_URL_MISSING', 'discovered', '无法从该抖音作品获取可下载视频，请改为上传本地视频。'],
    ['APP_INTERRUPTED', 'transcribed', '应用上次在处理期间退出，请重试此任务。'],
    ['MEDIA_COPY_FAILED', 'discovered', '视频准备失败，请确认文件仍可读取并检查磁盘空间。'],
    ['ASR_FAILED', 'audio_extracted', '文字转写失败，请稍后重试。'],
    ['AI_TIMEOUT', 'transcribed', 'AI 服务暂时不可用，请稍后重试。'],
    ['UNKNOWN_INTERNAL_FAILURE', 'audio_extracted', '文字转写失败，请稍后重试。']
  ] as const)('maps %s to stable Chinese without exposing persisted internals', (errorCode, stage, message) => {
    expect(stableWorkErrorMessage({ ...failed, errorCode, stage })).toBe(message)
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

  it('consumes every notification request token even for the same work', async () => {
    const failedThenCompleted = { ...failed, id: completed.id, title: completed.title }
    desktopApi.listWorks = vi.fn().mockResolvedValueOnce([failedThenCompleted]).mockResolvedValue([completed])
    const view = render(<WorksPage focusRequest={{ workId: completed.id, requestId: 'request-1' }} />)

    const row = await screen.findByRole('row', { name: new RegExp(completed.title) })
    await waitFor(() => expect(row).toHaveFocus())
    expect(screen.getByText('AI 拆解失败')).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: '搜索作品' })
    fireEvent.change(search, { target: { value: '不会匹配' } })
    search.focus()
    emitWorkChange?.(completed.id)
    view.rerender(<WorksPage focusRequest={{ workId: completed.id, requestId: 'request-2' }} />)
    await waitFor(() => expect(screen.getByRole('row', { name: new RegExp(completed.title) })).toHaveFocus())
    expect(screen.getByText('18,642')).toBeInTheDocument()
    expect(search).toHaveValue('')
  })
})
