import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardData, DashboardHighlight } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { DailyFocus } from '../features/overview/DailyFocus'
import { HighlightInspector } from '../features/overview/HighlightInspector'
import { HighlightList } from '../features/overview/HighlightList'
import { sortHighlights, type HighlightSortMode } from '../features/overview/highlight-sorting'
import { MetricStrip } from '../features/overview/MetricStrip'
import { TopicWorksInspector } from '../features/overview/TopicWorksInspector'
import './overview.css'

export function OverviewPage({ data: suppliedData, onRefresh, onOpenWork, onOpenFilter }: {
  data?: DashboardData
  onRefresh?: () => Promise<DashboardData | void>
  onOpenWork?(workId: string): void
  onOpenFilter?(filter: 'newly_viral' | 'warming'): void
}): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(suppliedData ?? null)
  const [selected, setSelected] = useState<DashboardHighlight | null>(null)
  const selectedTrigger = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const [selectedTopic, setSelectedTopic] = useState<DashboardData['topicRanking'][number] | null>(null)
  const selectedTopicTrigger = useRef<HTMLButtonElement | null>(null)
  const restoreTopicFocus = useRef(false)
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [highlightSortMode, setHighlightSortMode] = useState<HighlightSortMode>('heat')
  const sortedHighlights = useMemo(
    () => sortHighlights(data?.highlights ?? [], highlightSortMode),
    [data?.highlights, highlightSortMode]
  )

  useEffect(() => { if (!suppliedData && window.desktopApi) void window.desktopApi.getDashboard().then(setData) }, [suppliedData])
  const selectHighlight = useCallback((highlight: DashboardHighlight, trigger: HTMLButtonElement) => {
    selectedTrigger.current = trigger
    setSelected(highlight)
  }, [])
  const closeInspector = useCallback(() => {
    restoreFocus.current = true
    setSelected(null)
  }, [])
  useEffect(() => {
    if (!selected && restoreFocus.current) {
      selectedTrigger.current?.focus()
      restoreFocus.current = false
    }
  }, [selected])
  const selectTopic = useCallback((topic: DashboardData['topicRanking'][number], trigger: HTMLButtonElement) => {
    selectedTopicTrigger.current = trigger
    setSelectedTopic(topic)
  }, [])
  const closeTopicInspector = useCallback(() => {
    restoreTopicFocus.current = true
    setSelectedTopic(null)
  }, [])
  useEffect(() => {
    if (!selectedTopic && restoreTopicFocus.current) {
      selectedTopicTrigger.current?.focus()
      restoreTopicFocus.current = false
    }
  }, [selectedTopic])
  async function refresh(): Promise<void> {
    setRefreshState('loading')
    try {
      const result = onRefresh ? await onRefresh() : await window.desktopApi?.getDashboard()
      if (result) setData(result)
      setRefreshState('success')
    } catch { setRefreshState('error') }
  }

  if (!data) return <div className="page overview-skeleton" aria-label="正在加载总览"><span /><span /><span /></div>
  if (data.creators === 0) return <div className="page">
    <header className="page-heading"><div><h1>内容追踪</h1><p>持续追踪近 30 天作品的新增、升温与回落。</p></div></header>
    <EmptyState action={<Button icon={<Plus size={16} />} onClick={() => { window.location.hash = '#/creators' }}>添加第一个博主</Button>} description="添加博主后，应用会持续采集作品并建立表现基线。" title="还没有监控博主" />
  </div>

  const fastestGrowingWork = data.weekly.fastestGrowingWork
  const dailyFocus = sortedHighlights[0] ?? null
  return <div className="page overview-page">
    <header className="page-heading">
      <div><h1>内容追踪</h1><p>每天追踪近 30 天作品的新增、升温与回落。</p></div>
      <div className="refresh-control"><Button disabled={refreshState === 'loading'} icon={<RefreshCw className={refreshState === 'loading' ? 'is-spinning' : ''} size={16} />} onClick={() => void refresh()} variant="secondary">{refreshState === 'loading' ? '刷新中' : '刷新数据'}</Button><span aria-live="polite">{refreshState === 'success' ? '数据已更新' : refreshState === 'error' ? '刷新失败' : ''}</span></div>
    </header>
    <div className="overview-snapshot">
    <DailyFocus highlight={dailyFocus} onSelect={selectHighlight} />
    <MetricStrip items={[
      { label: '本周采集新作', value: data.weekly.collectedWorks, note: '本自然周首次发现' },
      { label: '本周新晋爆款', value: data.weekly.newViralWorks ?? 0, note: '首次达到爆款标准', onClick: () => onOpenFilter?.('newly_viral') },
      { label: '当前持续升温', value: data.weekly.warmingWorks ?? 0, note: '连续 3 天互动增长', onClick: () => onOpenFilter?.('warming') },
      fastestGrowingWork
        ? { label: '本周增长最快', value: `+${formatCompactNumber(fastestGrowingWork.likesGained)} 点赞`, note: `${fastestGrowingWork.title} · 较周初 +${fastestGrowingWork.growthRatePercent}%`, onClick: () => onOpenWork?.(fastestGrowingWork.id) }
        : { label: '本周增长最快', value: '数据积累中', note: '完成至少两次同步后显示' }
    ]} />
    </div>
    <div className="overview-grid overview-grid--rankings">
      <section className="highlight-section overview-work-surface" aria-labelledby="highlight-title">
        <div className="section-heading highlight-section__heading"><div><h2 id="highlight-title">近 30 天爆款 · Top 10</h2><p>{highlightSortMode === 'heat' ? '优先展示新晋、升温和高位稳定作品，回落作品排在末尾' : '优先展示相对表现指数更高的作品'}</p></div><div className="highlight-sort-meta"><div aria-label="Top 10 排序方式" className="highlight-sort-control" role="group"><button aria-pressed={highlightSortMode === 'heat'} onClick={() => setHighlightSortMode('heat')} type="button">热度优先</button><button aria-pressed={highlightSortMode === 'performance'} onClick={() => setHighlightSortMode('performance')} type="button">表现优先</button></div><span>{Math.min(10, sortedHighlights.length)} 条</span></div></div>
        <span aria-live="polite" className="visually-hidden">{highlightSortMode === 'heat' ? '已按热度排序' : '已按相对表现排序'}，今日重点为{dailyFocus?.title ?? '暂无作品'}</span>
        {sortedHighlights.length > 0 ? <HighlightList highlights={sortedHighlights.slice(0, 10)} onSelect={selectHighlight} /> : <EmptyState title="近 30 天还没有爆款" description="尚未发现点赞破万，或点赞至少 100 且相对表现达到阈值的作品。" />}
      </section>
      <section className="topic-ranking overview-work-surface" aria-labelledby="topic-ranking-title">
        <div className="section-heading"><div><h2 id="topic-ranking-title">选题洞察</h2><p>AI 综合归类近 30 天爆款，比较本周新增变化</p></div><span>{data.topicRanking.length} 类</span></div>
        {data.topicRankingState === 'ready' && data.topicRanking.length > 0 ? <div className="topic-ranking__list">{data.topicRanking.map((item) => {
          const maxCount = data.topicRanking[0]?.viralWorks ?? 1
          const delta = item.weekOverWeekDelta ?? 0
          return <button key={item.topic} onClick={(event) => selectTopic(item, event.currentTarget)} type="button">
            <span className="topic-ranking__title-line">
              <strong>{item.topic}</strong>
              <span className="topic-ranking__meta">
                <small>{item.viralWorks} 条爆款</small>
                {(item.newThisWeek ?? 0) > 0 ? <small>本周新晋 {item.newThisWeek} 条</small> : null}
                {delta !== 0 ? <small>较上周 {delta > 0 ? '+' : ''}{delta}</small> : null}
              </span>
            </span>
            <i style={{ width: `${Math.max(12, item.viralWorks / maxCount * 100)}%` }} />
            <small title={item.representativeTitle}>代表作：{item.representativeTitle}</small>
          </button>
        })}</div> : <EmptyState
          action={data.topicRankingState === 'failed' ? <Button disabled={refreshState === 'loading'} onClick={() => void refresh()} variant="secondary">{refreshState === 'loading' ? '正在重新归类…' : '重新归类'}</Button> : undefined}
          title={topicRankingTitle(data.topicRankingState, data.topicRankingMessage)}
          description={data.topicRankingMessage}
        />}
      </section>
    </div>
    {selected ? <HighlightInspector highlight={selected} onClose={closeInspector} /> : null}
    {selectedTopic ? <TopicWorksInspector
      topic={selectedTopic.topic}
      highlights={selectedTopic.workIds.map((workId) => data.highlights.find((highlight) => highlight.id === workId)).filter((highlight): highlight is DashboardHighlight => Boolean(highlight))}
      onClose={closeTopicInspector}
      onSelect={(workId) => { setSelectedTopic(null); onOpenWork?.(workId) }}
    /> : null}
  </div>
}

function formatCompactNumber(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1000) / 10}万` : value.toLocaleString('zh-CN')
}

function topicRankingTitle(state: DashboardData['topicRankingState'], message: string): string {
  if (state === 'insufficient') return '爆款样本不足'
  if (state === 'unconfigured') return message.includes('Codex') ? '本地 Codex 未就绪' : '尚未配置云端模型'
  if (state === 'failed') return '选题归类失败'
  return '暂无选题分类'
}
