import { AlertCircle, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkListItem } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import { RADAR_STATUS_LABELS } from '../overview/HighlightList'
import { stableWorkErrorMessage } from './WorkStatusRow'

export type SubscriptionFilter = 'all' | 'newly_viral' | 'warming' | 'viral'

export function SubscriptionWorkList({ works, selectedId, focusId, initialFilter = 'all', onSelect, onFocusConsumed, onRetry, onDeleteRequest, onLocalFallback }: {
  works: WorkListItem[]
  selectedId: string | null
  focusId?: string
  initialFilter?: SubscriptionFilter
  onSelect(id: string): void
  onFocusConsumed(id: string): void
  onRetry(id: string): Promise<void>
  onDeleteRequest(work: WorkListItem, trigger: HTMLButtonElement): void
  onLocalFallback(work: WorkListItem): void
}): React.JSX.Element {
  const [filter, setFilter] = useState<SubscriptionFilter>(initialFilter)
  useEffect(() => { setFilter(initialFilter) }, [initialFilter])
  const filtered = useMemo(() => works.filter((work) => {
    if (filter === 'newly_viral') return work.radarStatus === 'newly_viral'
    if (filter === 'warming') return work.radarStatus === 'warming'
    if (filter === 'viral') return work.reasons.includes('relative_performance') || work.reasons.includes('absolute_high_likes')
    return true
  }), [filter, works])
  const groups = useMemo(() => groupByLocalDay(filtered), [filtered])

  return (
    <section aria-labelledby="subscription-works-title" className="subscription-work-list">
      <header>
        <div><h2 id="subscription-works-title">作品列表</h2><span>{works.length} 条</span></div>
        <div aria-label="作品筛选" className="segmented" role="group">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>全部</FilterButton>
          <FilterButton active={filter === 'viral'} onClick={() => setFilter('viral')}>爆款</FilterButton>
          <FilterButton active={filter === 'newly_viral'} onClick={() => setFilter('newly_viral')}>新晋爆款</FilterButton>
          <FilterButton active={filter === 'warming'} onClick={() => setFilter('warming')}>热度升温</FilterButton>
        </div>
      </header>
      {groups.length === 0 ? <p className="workspace-empty-copy">当前博主还没有符合条件的作品。</p> : groups.map(([label, items]) => (
        <section className="work-day-group" key={label}>
          <h3>{label}</h3>
          <div>{items.map((work) => (
            <WorkListRow focus={focusId === work.id} key={work.id} onDeleteRequest={onDeleteRequest} onFocusConsumed={onFocusConsumed} onLocalFallback={onLocalFallback} onRetry={onRetry} onSelect={onSelect} selected={selectedId === work.id} work={work} />
          ))}</div>
        </section>
      ))}
    </section>
  )
}

function WorkListRow({ work, selected, focus, onSelect, onFocusConsumed, onRetry, onDeleteRequest, onLocalFallback }: {
  work: WorkListItem
  selected: boolean
  focus: boolean
  onSelect(id: string): void
  onFocusConsumed(id: string): void
  onRetry(id: string): Promise<void>
  onDeleteRequest(work: WorkListItem, trigger: HTMLButtonElement): void
  onLocalFallback(work: WorkListItem): void
}): React.JSX.Element {
  const selectRef = useRef<HTMLButtonElement>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  useEffect(() => {
    if (!focus) return
    selectRef.current?.focus()
    onFocusConsumed(work.id)
  }, [focus, onFocusConsumed, work.id])
  async function retry(): Promise<void> {
    if (retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      await onRetry(work.id)
    } catch {
      setRetryError('重试未能启动，请稍后再试。')
    } finally {
      setRetrying(false)
    }
  }
  const unavailable = work.errorCode === 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' || work.errorCode === 'DOUYIN_MEDIA_URL_MISSING'
  return (
    <article className="subscription-work-row" data-selected={selected || undefined}>
      <button aria-pressed={selected} className="subscription-work-row__select" onClick={() => onSelect(work.id)} ref={selectRef} type="button">
        <span className="subscription-work-row__heading"><strong>{work.title}</strong><time>{formatTime(work.publishedAt)}</time></span>
        <span className="subscription-work-row__badges">
          {work.radarStatus && work.radarStatus !== 'watching' ? <span className={`radar-status radar-status--${work.radarStatus}`}>{RADAR_STATUS_LABELS[work.radarStatus]}</span> : null}
          {work.reasons.includes('absolute_high_likes') ? <StatusBadge tone="success">高点赞</StatusBadge> : null}
          {work.reasons.includes('high_collects') ? <StatusBadge tone="success">高收藏</StatusBadge> : null}
          {work.reasons.includes('high_comments') ? <StatusBadge tone="success">高评论</StatusBadge> : null}
          {work.reasons.includes('high_shares') ? <StatusBadge tone="success">高转发</StatusBadge> : null}
          {work.reasons.includes('relative_performance_surge') ? <StatusBadge tone="warning">相对暴增</StatusBadge> : null}
          {work.reasons.includes('relative_performance') ? <StatusBadge tone="warning">相对突出</StatusBadge> : null}
        </span>
        <span className="subscription-work-row__meta"><span>{work.likes.toLocaleString('zh-CN')} 点赞</span><span>{workStatusLabel(work)}</span></span>
        {work.status === 'failed' ? <small className="subscription-work-row__error"><AlertCircle size={13} aria-hidden="true" />{stableWorkErrorMessage(work)}</small> : null}
      </button>
      {work.status === 'failed' ? <div className="subscription-work-row__actions">
        {unavailable ? <Button aria-label="改为上传本地视频" icon={<Upload size={14} />} onClick={() => onLocalFallback(work)} variant="ghost" /> : null}
        {work.retryable ? <Button aria-label={`重试${work.title}`} disabled={retrying} icon={<RotateCcw size={14} />} onClick={() => void retry()} variant="ghost" /> : null}
        <Button aria-label={`删除失败任务：${work.title}`} icon={<Trash2 size={14} />} onClick={(event) => onDeleteRequest(work, event.currentTarget)} variant="ghost" />
      </div> : null}
      {retryError ? <p className="subscription-work-row__retry-error" role="alert">{retryError}</p> : null}
    </article>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }): React.JSX.Element {
  return <button aria-pressed={active} onClick={onClick} type="button">{children}</button>
}

function groupByLocalDay(works: WorkListItem[]): Array<[string, WorkListItem[]]> {
  const sorted = [...works].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const groups = new Map<string, WorkListItem[]>()
  for (const work of sorted) {
    const date = new Date(work.publishedAt)
    const key = Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
    const current = groups.get(key) ?? []
    current.push(work)
    groups.set(key, current)
  }
  return [...groups.entries()]
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function runningLabel(stage: WorkListItem['stage']): string {
  if (stage === 'transcribed') return '正在 AI 拆解'
  if (stage === 'audio_extracted') return '正在转成文字'
  return '正在准备内容'
}

function workStatusLabel(work: WorkListItem): string {
  if (work.status === 'pending') return '等待处理'
  if (work.status === 'running') return work.progressLabel ?? runningLabel(work.stage)
  if (work.status === 'failed') return '处理失败'
  return '已完成'
}
