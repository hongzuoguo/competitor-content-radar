import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { HashRouter, MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import type { CreatorView, WorkDetail, WorkListItem } from '../../src/shared/ipc-contract'
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
  publishedAt: '2026-07-14T08:00:00.000Z', status: 'completed', stage: 'completed', errorCode: null, errorMessage: null,
  retryable: false, likes: 18_642, relativeViralIndex: 238, referenceValueScore: 91,
  reasons: ['absolute_high_likes', 'relative_viral', 'high_reference_value']
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
    structure: ['提出误区', '给出案例', '总结方法'], viralPoints: ['结果反差'], interactionGuidance: '邀请观众分享经历',
    highlights: ['案例具体'], reusablePatterns: ['误区—案例—方法'],
    differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] },
    referenceValueScore: 91, referenceValueReason: '结构清楚且可复用'
  }
}

let emitWorkChange: ((workId: string) => void) | undefined

function installApi(works: WorkListItem[] = [other, older, newest], selectedDetail: WorkDetail | null = detail): DesktopApi {
  const api = {
    listCreators: vi.fn().mockResolvedValue(creators),
    listWorks: vi.fn().mockResolvedValue(works),
    getWork: vi.fn().mockImplementation(async (id: string) => id === selectedDetail?.id ? selectedDetail : ({ ...detail, ...works.find((work) => work.id === id) })),
    onWorkStateChanged: vi.fn((listener: (workId: string) => void) => { emitWorkChange = listener; return vi.fn() }),
    retryImport: vi.fn(), deleteFailedWork: vi.fn(), pickLocalVideo: vi.fn(), getPathForFile: vi.fn(), startImport: vi.fn()
  } as unknown as DesktopApi
  Object.defineProperty(window, 'desktopApi', { configurable: true, value: api })
  return api
}

describe('subscription workspace', () => {
  beforeEach(() => { vi.clearAllMocks(); emitWorkChange = undefined })

  it('selects the first enabled creator and newest work, then scopes the middle list', async () => {
    const api = installApi()
    render(<WorksPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /增长实验室/ })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.getByRole('button', { name: /最新作品/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('较早作品')).toBeInTheDocument()
    expect(screen.queryByText('另一位博主作品')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getWork).toHaveBeenCalledWith('work-new'))

    fireEvent.click(screen.getByRole('button', { name: /内容手记/ }))
    expect(await screen.findByText('另一位博主作品')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '作品列表' })).queryByText('最新作品')).not.toBeInTheDocument()
  })

  it('filters by worthwhile and viral signals and shows all decision labels', async () => {
    installApi()
    render(<WorksPage />)
    await screen.findByRole('button', { name: /最新作品/ })

    expect(screen.getAllByText('高点赞').length).toBeGreaterThan(0)
    expect(screen.getAllByText('相对爆款').length).toBeGreaterThan(0)
    expect(screen.getAllByText('高借鉴').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '值得看' }))
    expect(screen.queryByText('较早作品')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '爆款' }))
    expect(within(screen.getByRole('region', { name: '作品列表' })).getByText('最新作品')).toBeInTheDocument()
  })

  it('loads metrics, transcript and the six analysis sections', async () => {
    installApi()
    render(<WorksPage />)
    const inspector = await screen.findByRole('region', { name: '作品详情' })
    await within(inspector).findByText('18,642')
    expect(within(inspector).getByText('结构清楚且可复用')).toBeInTheDocument()
    for (const heading of ['选题角度', '开头钩子', '内容结构', '视频爆点', '互动引导', '亮点内容']) {
      expect(within(inspector).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    fireEvent.click(within(inspector).getByRole('tab', { name: '完整文案' }))
    expect(within(inspector).getByText('这是完整文字稿。')).toBeInTheDocument()
  })

  it('shows an explicit waiting state when analysis is not available', async () => {
    installApi([{ ...newest, status: 'running', stage: 'transcribed' }], { ...detail, status: 'running', stage: 'transcribed', analysis: null, analysisProvider: null, analyzedAt: null })
    render(<WorksPage />)
    expect(await screen.findByText('等待 AI 拆解')).toBeInTheDocument()
    expect(screen.getByText('文字稿已准备好，配置模型后会继续生成拆解。')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /增长实验室/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /较早作品/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps local imports and disabled creator works selectable beside subscriptions', async () => {
    const local = { ...older, id: 'work-local', creatorId: null, creatorName: '未分类作品', title: '本地导入样片', sourceType: 'local_file' as const }
    const disabled = { id: 'creator-disabled', name: '已停用博主', profileUrl: 'https://www.douyin.com/user/disabled', enabled: false, works: 1, lastRun: '昨天', status: 'attention' as const }
    const disabledWork = { ...older, id: 'work-disabled', creatorId: disabled.id, creatorName: disabled.name, title: '停用前作品' }
    installApi([newest, local, disabledWork])
    vi.mocked(window.desktopApi.listCreators).mockResolvedValue([...creators, disabled])
    render(<WorksPage focusRequest={{ workId: local.id, requestId: 'focus-local' }} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /未分类作品/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: /本地导入样片/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('最新作品')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已停用博主/ }))
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
