import { AlertCircle, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkListItem } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import { stableWorkErrorMessage } from './WorkStatusRow'

export type SubscriptionFilter = 'all' | 'worthwhile' | 'viral'

export function SubscriptionWorkList({ works, selectedId, focusId, onSelect, onFocusConsumed, onRetry, onDeleteRequest, onLocalFallback }: {
  works: WorkListItem[]
  selectedId: string | null
  focusId?: string
  onSelect(id: string): void
  onFocusConsumed(id: string): void
  onRetry(id: string): Promise<void>
  onDeleteRequest(work: WorkListItem, trigger: HTMLButtonElement): void
  onLocalFallback(work: WorkListItem): void
}): React.JSX.Element {
  const [filter, setFilter] = useState<SubscriptionFilter>('all')
  const filtered = useMemo(() => works.filter((work) => {
    if (filter === 'worthwhile') return work.reasons.length > 0
    if (filter === 'viral') return work.reasons.includes('relative_viral')
    return true
  }), [filter, works])
  const groups = useMemo(() => groupByLocalDay(filtered), [filtered])

  return (
    <section aria-label="作品列表" className="subscription-work-list">
      <header>
        <div><h2>作品</h2><span>{works.length} 条</span></div>
        <div aria-label="作品筛选" className="segmented" role="group">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>全部</FilterButton>
          <FilterButton active={filter === 'worthwhile'} onClick={() => setFilter('worthwhile')}>值得看</FilterButton>
          <FilterButton active={filter === 'viral'} onClick={() => setFilter('viral')}>爆款</FilterButton>
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
  useEffect(() => {
    if (!focus) return
    selectRef.current?.focus()
    onFocusConsumed(work.id)
  }, [focus, onFocusConsumed, work.id])
  async function retry(): Promise<void> {
    if (retrying) return
    setRetrying(true)
    try { await onRetry(work.id) } finally { setRetrying(false) }
  }
  const unavailable = work.errorCode === 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' || work.errorCode === 'DOUYIN_MEDIA_URL_MISSING'
  return (
    <article className="subscription-work-row" data-selected={selected || undefined}>
      <button aria-pressed={selected} className="subscription-work-row__select" onClick={() => onSelect(work.id)} ref={selectRef} type="button">
        <span className="subscription-work-row__heading"><strong>{work.title}</strong><time>{formatTime(work.publishedAt)}</time></span>
        <span className="subscription-work-row__badges">
          {isRecent(work.publishedAt) ? <StatusBadge>新作品</StatusBadge> : null}
          {work.reasons.includes('absolute_high_likes') ? <StatusBadge tone="success">高点赞</StatusBadge> : null}
          {work.reasons.includes('relative_viral') ? <StatusBadge tone="warning">相对爆款</StatusBadge> : null}
          {work.reasons.includes('high_reference_value') ? <StatusBadge>高借鉴</StatusBadge> : null}
        </span>
        {work.status === 'pending' || work.status === 'running' ? <small>处理中 · {runningLabel(work.stage)}</small> : null}
        {work.status === 'failed' ? <small className="subscription-work-row__error"><AlertCircle size={13} aria-hidden="true" />{stableWorkErrorMessage(work)}</small> : null}
      </button>
      {work.status === 'failed' ? <div className="subscription-work-row__actions">
        {unavailable ? <Button aria-label="改为上传本地视频" icon={<Upload size={14} />} onClick={() => onLocalFallback(work)} variant="ghost" /> : null}
        {work.retryable ? <Button aria-label={`重试${work.title}`} disabled={retrying} icon={<RotateCcw size={14} />} onClick={() => void retry()} variant="ghost" /> : null}
        <Button aria-label={`删除失败任务：${work.title}`} icon={<Trash2 size={14} />} onClick={(event) => onDeleteRequest(work, event.currentTarget)} variant="ghost" />
      </div> : null}
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

function isRecent(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 5 * 24 * 60 * 60 * 1000
}

function runningLabel(stage: WorkListItem['stage']): string {
  if (stage === 'transcribed') return '正在 AI 拆解'
  if (stage === 'audio_extracted') return '正在转成文字'
  return '正在准备内容'
}
