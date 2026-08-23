import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { HashRouter, MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import type { CreatorView, RunHistoryItem, WorkDetail, WorkListItem } from '../../src/shared/ipc-contract'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'
import { CreatorRail } from '../../src/renderer/src/features/works/CreatorRail'

function render(ui: ReactNode): ReturnType<typeof testingRender> {
  return testingRender(ui, { wrapper: MemoryRouter })
}

const creators: CreatorView[] = [
  { id: 'creator-a', name: '增长实验室', profileUrl: 'https://www.douyin.com/user/a', enabled: true, works: 2, lastRun: '刚刚', status: 'ready' },
  { id: 'creator-b', name: '内容手记', profileUrl: 'https://www.douyin.com/user/b', enabled: true, works: 1, lastRun: '刚刚', status: 'ready' }
]

const newest: WorkListItem = {
  id: 'work-new', creatorId: 'creator-a', creatorName: '增长实验室', title: '最新作品', sourceType: 'douyin_monitor',
  ownership: 'competitor',
  publishedAt: '2026-07-14T08:00:00.000Z', status: 'completed', stage: 'completed', errorCode: null, errorMessage: null,
  retryable: false, likes: 18_642, relativePerformanceMultiplier: 2.4, canAnalyzeManually: false,
  reasons: ['absolute_high_likes', 'relative_performance']
}
const older: WorkListItem = { ...newest, id: 'work-old', title: '较早作品', publishedAt: '2026-07-13T08:00:00.000Z', reasons: [] }
const other: WorkListItem = { ...newest, id: 'work-other', creatorId: 'creator-b', creatorName: '内容手记', title: '另一位博主作品' }

const detail: WorkDetail = {
  ...newest,
  originalUrl: 'https://www.douyin.com/video/1', comments: 321, shares: 45, collects: 678,
  transcript: '这是完整文字稿。', analysisProvider: 'deepseek', analyzedAt: '2026-07-14T09:00:00.000Z',
  analysis: {
    topicAngle: '从反常识切入',
    openingHook: { quote: '你以为努力就够了吗？', type: '反问', mechanism: '制造认知冲突' },
    structure: ['提出误区', '给出案例', '总结方法'], viralPoints: ['结果反差'],
    highlights: ['案例具体'], reusablePatterns: ['误区—案例—方法'],
    differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
  }
}

let emitWorkChange: ((workId: string) => void) | undefined

function installApi(works: WorkListItem[] = [other, older, newest], selectedDetail: WorkDetail | null = detail): DesktopApi {
  const api = {
    listCreators: vi.fn().mockResolvedValue(creators),
    listWorks: vi.fn().mockResolvedValue(works),
    getWork: vi.fn().mockImplementation(async (id: string) => id === selectedDetail?.id ? selectedDetail : ({ ...detail, ...works.find((work) => work.id === id) })),
    analyzeWork: vi.fn().mockResolvedValue({ accepted: true }),
    onWorkStateChanged: vi.fn((listener: (workId: string) => void) => { emitWorkChange = listener; return vi.fn() }),
    retryImport: vi.fn(), deleteFailedWork: vi.fn(), pickLocalVideo: vi.fn(), getPathForFile: vi.fn(), startImport: vi.fn(),
    toggleCreator: vi.fn(), deleteCreator: vi.fn(), clearUnclassifiedWorks: vi.fn(), listRuns: vi.fn().mockResolvedValue([]),
    retryRun: vi.fn().mockResolvedValue({ accepted: true }), retryFailedCreators: vi.fn().mockResolvedValue({ accepted: true })
  } as unknown as DesktopApi
  Object.defineProperty(window, 'desktopApi', { configurable: true, value: api })
  return api
}

describe('subscription workspace', () => {
  beforeEach(() => { vi.clearAllMocks(); emitWorkChange = undefined })

  it('selects the first enabled creator and newest work, then scopes the middle list', async () => {
    const api = installApi()
    render(<WorksPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^增长实验室/ })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.getByRole('button', { name: /最新作品/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('较早作品')).toBeInTheDocument()
    expect(screen.queryByText('另一位博主作品')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getWork).toHaveBeenCalledWith('work-new'))

    fireEvent.click(screen.getByRole('button', { name: /^内容手记/ }))
    expect(await screen.findByText('另一位博主作品')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '作品列表' })).queryByText('最新作品')).not.toBeInTheDocument()
  })

  it('exposes the three workspace columns as named regions', async () => {
    installApi()
    render(<WorksPage />)

    const creatorRegion = await screen.findByRole('region', { name: '作品来源' })
    const workRegion = screen.getByRole('region', { name: '作品列表' })
    const inspectorRegion = screen.getByRole('region', { name: '作品详情' })

    expect(creatorRegion).toHaveAttribute('aria-labelledby', 'subscription-creators-title')
    expect(workRegion).toHaveAttribute('aria-labelledby', 'subscription-works-title')
    expect(inspectorRegion).toHaveAttribute('aria-labelledby', 'subscription-inspector-title')
  })

  it('pauses and permanently deletes a creator source from its menu', async () => {
    const api = installApi()
    vi.mocked(api.toggleCreator).mockResolvedValue(undefined)
    vi.mocked(api.deleteCreator).mockResolvedValue(undefined)
    render(<WorksPage />)

    fireEvent.click(await screen.findByRole('button', { name: '管理来源：增长实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停自动监控' }))
    await waitFor(() => expect(api.toggleCreator).toHaveBeenCalledWith('creator-a', false))
    fireEvent.click(screen.getByRole('button', { name: '管理来源：增长实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '永久删除来源' }))
    expect(screen.getByRole('dialog', { name: '永久删除增长实验室？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }))
    await waitFor(() => expect(api.deleteCreator).toHaveBeenCalledWith('creator-a'))
  })

  it('opens source deletion as a modal and can cancel without deleting', async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement): void { this.setAttribute('open', '') })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
    const api = installApi()
    render(<WorksPage />)

    fireEvent.click(await screen.findByRole('button', { name: '管理来源：增长实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '永久删除来源' }))

    await waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '永久删除增长实验室？' })).not.toBeInTheDocument()
    expect(api.deleteCreator).not.toHaveBeenCalled()
  })

  it('keeps a zero-work creator visible so the failed source can still be managed', async () => {
    installApi([])
    vi.mocked(window.desktopApi.listCreators).mockResolvedValue([{ ...creators[0], works: 0, status: 'attention' }])
    render(<WorksPage />)

    expect(await screen.findByRole('button', { name: /^增长实验室/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '作品列表' })).toBeInTheDocument()
  })

  it('clears unclassified works from the source menu after confirmation', async () => {
    const local = { ...older, id: 'work-local', creatorId: null, creatorName: '未分类作品', title: '本地导入样片', sourceType: 'local_file' as const }
    const api = installApi([local])
    vi.mocked(api.clearUnclassifiedWorks).mockResolvedValue(undefined)
    render(<WorksPage />)

    fireEvent.click(await screen.findByRole('button', { name: '管理来源：未分类作品' }))
    fireEvent.click(screen.getByRole('button', { name: '清空未分类作品' }))
    expect(screen.getByRole('dialog', { name: '清空未分类作品？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }))
    await waitFor(() => expect(api.clearUnclassifiedWorks).toHaveBeenCalledOnce())
  })

  it('filters by viral signals and shows the current decision labels', async () => {
    installApi()
    render(<WorksPage />)
    await screen.findByRole('button', { name: /最新作品/ })

    expect(screen.getAllByText('高点赞').length).toBeGreaterThan(0)
    expect(screen.getAllByText('相对突出').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '爆款' }))
    expect(within(screen.getByRole('region', { name: '作品列表' })).getByText('最新作品')).toBeInTheDocument()
  })

  it('loads metrics, transcript and the five analysis sections', async () => {
    installApi()
    render(<WorksPage />)
    const inspector = await screen.findByRole('region', { name: '作品详情' })
    await within(inspector).findByText('18,642')
    expect(within(inspector).getByText('案例具体')).toBeInTheDocument()
    for (const heading of ['角度', '钩子', '结构', '爆点', '亮点']) {
      expect(within(inspector).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(within(inspector).queryByText('互动引导')).not.toBeInTheDocument()
    fireEvent.click(within(inspector).getByRole('tab', { name: '完整文案' }))
    expect(within(inspector).getByText('这是完整文字稿。')).toBeInTheDocument()
  })

  it('shows an explicit waiting state when analysis is not available', async () => {
    installApi([{ ...newest, status: 'running', stage: 'transcribed' }], { ...detail, status: 'running', stage: 'transcribed', analysis: null, analysisProvider: null, analyzedAt: null })
    render(<WorksPage />)
    expect(await screen.findByText('正在处理')).toBeInTheDocument()
    expect(screen.getByText('正在处理作品，完成后会在这里显示五项拆解。')).toBeInTheDocument()
  })

  it('shows why manual analysis could not start', async () => {
    const pending = { ...newest, canAnalyzeManually: true, reasons: [] }
    const pendingDetail = {
      ...detail, ...pending, analysis: null, analysisProvider: null, analyzedAt: null,
      status: 'completed' as const, stage: 'completed' as const
    }
    const api = installApi([pending], pendingDetail)
    vi.mocked(api.analyzeWork).mockResolvedValue({ accepted: false, reason: 'AGENT_CLI_NOT_FOUND' })

    render(<WorksPage />)
    fireEvent.click(await screen.findByRole('button', { name: '手动拆解' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('未检测到可用的本地 Codex')
  })

  it('re-enables manual retry after an accepted analysis run settles as failed', async () => {
    const pending = { ...newest, status: 'failed' as const, stage: 'analyzed' as const, canAnalyzeManually: true, reasons: [], errorCode: 'AI_ANALYSIS_INVALID', errorMessage: 'AI_ANALYSIS_INVALID' }
    const pendingDetail = {
      ...detail, ...pending, analysis: null, analysisProvider: null, analyzedAt: null
    }
    const api = installApi([pending], pendingDetail)
    vi.mocked(api.getWork).mockResolvedValue(pendingDetail)

    render(<WorksPage />)
    fireEvent.click(await screen.findByRole('button', { name: '重试拆解' }))
    expect(await screen.findByRole('button', { name: '拆解已启动' })).toBeDisabled()

    emitWorkChange?.(pending.id)

    expect(await screen.findByRole('button', { name: '重试拆解' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '重试拆解' }))
    await waitFor(() => expect(api.analyzeWork).toHaveBeenCalledTimes(2))
  })

  it('replaces the previous failure banner when a new run starts', async () => {
    const api = installApi()
    const previous: RunHistoryItem = {
      id: 'run-previous', kind: 'manual', status: 'partial',
      startedAt: '2026-07-16T08:48:39.000Z', finishedAt: '2026-07-16T08:48:55.000Z',
      discovered: 16, selectedForAnalysis: 7, analyzed: 0,
      failures: [{ creatorId: 'creator-a', creatorName: '增长实验室', stage: 'discovery', code: 'SCRAPLING_ENGINE_INTERNAL', message: 'SCRAPLING_ENGINE_INTERNAL', occurredAt: '2026-07-16T08:48:55.000Z' }]
    }
    const running: RunHistoryItem = {
      id: 'run-current', kind: 'manual', status: 'running',
      startedAt: '2026-07-16T09:25:58.000Z', finishedAt: null,
      discovered: 0, selectedForAnalysis: 0, analyzed: 0, failures: []
    }
    vi.mocked(api.listRuns).mockResolvedValueOnce([previous]).mockResolvedValue([running, previous])

    render(<WorksPage />)
    expect(await screen.findByText(/采集组件运行异常。请先点击「重试采集」/)).toBeInTheDocument()
    expect(screen.queryByText('SCRAPLING_ENGINE_INTERNAL')).not.toBeInTheDocument()
    expect(screen.getByText(/部分完成：成功 0 条 \/ 失败 1 条/)).toBeInTheDocument()

    window.dispatchEvent(new Event('content-radar:run-started'))

    expect(await screen.findByText(/本次任务正在运行/)).toBeInTheDocument()
    expect(screen.queryByText(/采集组件运行异常。请先点击「重试采集」/)).not.toBeInTheDocument()
  })

  it('closes an accepted targeted retry even when run refresh fails and restores safe focus', async () => {
    const api = installApi()
    const previous: RunHistoryItem = {
      id: 'run-retry', kind: 'manual', status: 'partial',
      startedAt: '2026-07-16T08:48:39.000Z', finishedAt: '2026-07-16T08:48:55.000Z',
      discovered: 0, selectedForAnalysis: 0, analyzed: 0,
      failures: [{ creatorId: 'creator-a', creatorName: '增长实验室', stage: 'discovery', code: 'SCRAPLING_ENGINE_INTERNAL', message: 'raw', occurredAt: '2026-07-16T08:48:55.000Z' }]
    }
    vi.mocked(api.listRuns).mockResolvedValueOnce([previous])
      .mockRejectedValueOnce(new Error('refresh failed'))
    vi.mocked(api.retryFailedCreators).mockResolvedValue({ accepted: true })
    render(<WorksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    expect(screen.getByRole('dialog', { name: '失败详情' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '增长实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '失败详情' })).not.toBeInTheDocument())
    expect(api.retryFailedCreators).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('运行记录刷新失败，任务仍已正常启动。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /查看失败详情/ })).toHaveFocus())
  })

  it('moves focus to the works region when a successful retry replaces its failure banner', async () => {
    const api = installApi()
    const previous: RunHistoryItem = {
      id: 'run-retry-focus', kind: 'manual', status: 'partial',
      startedAt: '2026-07-16T08:48:39.000Z', finishedAt: '2026-07-16T08:48:55.000Z',
      discovered: 0, selectedForAnalysis: 0, analyzed: 0,
      failures: [{ creatorId: 'creator-a', creatorName: '增长实验室', stage: 'discovery', code: 'SCRAPLING_ENGINE_INTERNAL', message: 'raw', occurredAt: '2026-07-16T08:48:55.000Z' }]
    }
    const running: RunHistoryItem = { ...previous, id: 'run-running', status: 'running', finishedAt: null, failures: [] }
    vi.mocked(api.listRuns).mockResolvedValueOnce([previous]).mockResolvedValueOnce([running])
    vi.mocked(api.retryFailedCreators).mockResolvedValue({ accepted: true })
    render(<WorksPage />)

    fireEvent.click(await screen.findByRole('button', { name: /查看失败详情/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: '增长实验室' }))
    fireEvent.click(screen.getByRole('button', { name: '重采所选博主' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '失败详情' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('region', { name: '作品表格区域' })).toHaveFocus())
  })

  it('refreshes without losing the selected creator or work', async () => {
    const api = installApi()
    render(<WorksPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /最新作品/ })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(await screen.findByRole('button', { name: /较早作品/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /较早作品/ })).toHaveAttribute('aria-pressed', 'true'))
    emitWorkChange?.('work-old')
    await waitFor(() => expect(api.listWorks).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(vi.mocked(api.getWork).mock.calls.filter(([id]) => id === 'work-old')).toHaveLength(2))
    expect(screen.getByRole('button', { name: /^增长实验室/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /较早作品/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps local imports and disabled creator works selectable beside subscriptions', async () => {
    const local = { ...older, id: 'work-local', creatorId: null, creatorName: '未分类作品', title: '本地导入样片', sourceType: 'local_file' as const }
    const disabled = { id: 'creator-disabled', name: '已停用博主', profileUrl: 'https://www.douyin.com/user/disabled', enabled: false, works: 1, lastRun: '昨天', status: 'attention' as const }
    const disabledWork = { ...older, id: 'work-disabled', creatorId: disabled.id, creatorName: disabled.name, title: '停用前作品' }
    installApi([newest, local, disabledWork])
    vi.mocked(window.desktopApi.listCreators).mockResolvedValue([...creators, disabled])
    render(<WorksPage focusRequest={{ workId: local.id, requestId: 'focus-local' }} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^未分类作品/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: /本地导入样片/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('最新作品')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^已停用博主/ }))
    expect(await screen.findByText('停用前作品')).toBeInTheDocument()
  })

  it('shows retry failure inline, releases the lock, and allows another attempt', async () => {
    const failedWork = { ...older, id: 'work-failed-retry', status: 'failed' as const, stage: 'transcribed' as const, retryable: true, errorCode: 'ANALYSIS_FAILED', errorMessage: 'hidden' }
    installApi([failedWork])
    vi.mocked(window.desktopApi.listCreators).mockResolvedValue([])
    vi.mocked(window.desktopApi.retryImport).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ accepted: true, workId: failedWork.id })
    render(<WorksPage />)

    const retry = await screen.findByRole('button', { name: `重试${failedWork.title}` })
    fireEvent.click(retry)
    expect(await screen.findByText('重试未能启动，请稍后再试。')).toHaveAttribute('role', 'alert')
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(window.desktopApi.retryImport).toHaveBeenCalledTimes(2))
  })

  it('shows formatted likes and the actual processing state on every work row', async () => {
    installApi([newest, { ...older, id: 'work-running-meta', status: 'running', stage: 'audio_extracted', likes: 321 }])
    render(<WorksPage />)
    expect(await screen.findByRole('button', { name: /最新作品.*18,642 点赞.*已完成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /较早作品.*321 点赞.*正在转成文字/ })).toBeInTheDocument()
  })

  it('shows the complete work title without a redundant new-work badge', async () => {
    const longTitle = '我让 AI 拆了个涨 20 万粉的账号，做出的报告有点东西 #自媒体 #AI实战'
    installApi([{ ...newest, title: longTitle }])
    render(<WorksPage />)

    const workButton = await screen.findByRole('button', { name: new RegExp(longTitle) })
    expect(within(workButton).getByText(longTitle)).toBeInTheDocument()
    expect(within(workButton).queryByText('新作品')).not.toBeInTheDocument()
    expect(within(workButton).getByText('18,642 点赞')).toBeInTheDocument()
    expect(within(workButton).getByText('相对突出')).toBeInTheDocument()
  })

  it('supports complete keyboard tab semantics in the work inspector', async () => {
    installApi()
    render(<WorksPage />)
    const analysis = await screen.findByRole('tab', { name: 'AI 拆解' })
    const transcript = screen.getByRole('tab', { name: '完整文案' })
    expect(analysis).toHaveAttribute('aria-controls')
    expect(document.getElementById(analysis.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')

    analysis.focus()
    fireEvent.keyDown(analysis, { key: 'ArrowRight' })
    expect(transcript).toHaveFocus()
    expect(transcript).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '完整文案' })).toHaveTextContent('这是完整文字稿。')
    fireEvent.keyDown(transcript, { key: 'End' })
    expect(screen.getByRole('tab', { name: '数据趋势' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: '数据趋势' }), { key: 'Home' })
    expect(analysis).toHaveFocus()
    fireEvent.keyDown(analysis, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '数据趋势' })).toHaveFocus()
  })

  it('keeps creator management inside the hash router', () => {
    window.location.hash = '/works'
    testingRender(<HashRouter><CreatorRail creators={creators} onSelect={vi.fn()} selectedId="creator-a" works={[newest]} /></HashRouter>)
    expect(screen.getByRole('link', { name: '添加博主' })).toHaveAttribute('href', '#/creators')
  })
})
