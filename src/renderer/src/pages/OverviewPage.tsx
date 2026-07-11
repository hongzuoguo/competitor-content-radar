import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DashboardData, DashboardHighlight } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { HighlightInspector } from '../features/overview/HighlightInspector'
import { HighlightList } from '../features/overview/HighlightList'
import { MetricStrip } from '../features/overview/MetricStrip'
import { RunStatus } from '../features/overview/RunStatus'
import { TaskHealth } from '../features/overview/TaskHealth'
import { OVERVIEW_DEMO_DATA } from '../features/overview/demo-data'
import './overview.css'

export function OverviewPage({
  data: suppliedData,
  onRefresh
}: {
  data?: DashboardData
  onRefresh?: () => Promise<DashboardData | void>
}): React.JSX.Element {
  const previewData = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
    ? OVERVIEW_DEMO_DATA
    : null
  const [data, setData] = useState<DashboardData | null>(suppliedData ?? previewData)
  const [selected, setSelected] = useState<DashboardHighlight | null>(null)
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (!suppliedData && !previewData && window.desktopApi) void window.desktopApi.getDashboard().then(setData)
  }, [suppliedData, previewData])

  const closeInspector = useCallback(() => setSelected(null), [])

  async function refresh(): Promise<void> {
    setRefreshState('loading')
    try {
      const result = onRefresh
        ? await onRefresh()
        : window.desktopApi
          ? await window.desktopApi.getDashboard()
          : undefined
      if (result) setData(result)
      setRefreshState('success')
    } catch {
      setRefreshState('error')
    }
  }

  if (!data) return <div className="page overview-skeleton" aria-label="正在加载总览"><span /><span /><span /></div>

  if (data.creators === 0) {
    return (
      <div className="page">
        <header className="page-heading"><div><h1>今日总览</h1><p>每天先看结论，再决定哪些内容值得深入研究。</p></div></header>
        <EmptyState
          action={<Button icon={<Plus size={16} />} onClick={() => { window.location.hash = '#/setup' }}>添加第一个博主</Button>}
          description="添加第一个博主后，应用会采集近 30 条作品作为基线，并分析最近 120 小时的新内容。"
          title="还没有监控博主"
        />
      </div>
    )
  }

  return (
    <div className="page overview-page">
      <header className="page-heading">
        <div><h1>今日总览</h1><p>已为你筛出值得优先研究的作品，并说明入选原因。</p></div>
        <div className="refresh-control">
          <Button disabled={refreshState === 'loading'} icon={<RefreshCw className={refreshState === 'loading' ? 'is-spinning' : ''} size={16} />} onClick={() => void refresh()} variant="secondary">{refreshState === 'loading' ? '刷新中' : '刷新数据'}</Button>
          <span aria-live="polite">{refreshState === 'success' ? '数据已更新' : refreshState === 'error' ? '刷新失败，请检查连接后重试' : ''}</span>
        </div>
      </header>
      <div className="overview-grid">
        <section className="highlight-section" aria-labelledby="highlight-title">
          <div className="section-heading"><div><h2 id="highlight-title">今日重点</h2><p>点击作品查看入选原因和可借鉴内容</p></div><span>{data.highlights.length} 条</span></div>
          {data.highlights.length > 0 ? <HighlightList highlights={data.highlights} onSelect={(highlight) => setSelected(highlight)} /> : <EmptyState title="今天还没有重点作品" description="没有作品达到 10,000 点赞、150 相对爆款指数或 80 分借鉴价值。" />}
        </section>
        <TaskHealth onAction={(service) => service.id === 'douyin' ? void window.desktopApi?.loginDouyin() : window.location.hash = '#/settings'} services={data.services} />
      </div>
      <MetricStrip items={[
        { label: '监控博主', value: data.creators, note: '最多 10 位' },
        { label: '今日新增', value: data.newWorks, note: '近 120 小时' },
        { label: '完成拆解', value: data.analyzedWorks, note: data.newWorks === data.analyzedWorks ? '全部完成' : `${Math.round((data.analyzedWorks / Math.max(data.newWorks, 1)) * 100)}% 已完成` },
        { label: '今日重点', value: data.highlights.length, note: '满足任一判断标准' }
      ]} />
      <RunStatus lastRunAt={data.lastRunAt} run={data.run} />
      {selected ? <HighlightInspector highlight={selected} onClose={closeInspector} /> : null}
    </div>
  )
}
