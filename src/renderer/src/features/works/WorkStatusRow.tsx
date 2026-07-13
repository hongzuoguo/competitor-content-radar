import { AlertCircle, LoaderCircle, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WorkListItem } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'

const RUNNING_LABELS: Record<WorkListItem['stage'], string> = {
  discovered: '正在准备视频',
  downloaded: '正在提取音频',
  audio_extracted: '正在转成文字',
  transcribed: '正在 AI 拆解',
  analyzed: '正在保存结果',
  synced: '正在完成',
  completed: '处理完成'
}

const FAILED_LABELS: Record<WorkListItem['stage'], string> = {
  discovered: '视频准备失败',
  downloaded: '音频提取失败',
  audio_extracted: '文字转写失败',
  transcribed: 'AI 拆解失败',
  analyzed: '结果保存失败',
  synced: '同步失败',
  completed: '任务完成失败'
}

export function WorkStatusRow({
  focusOnRender,
  onLocalFallback,
  onRetry,
  work
}: {
  focusOnRender: boolean
  onLocalFallback(work: WorkListItem): void
  onRetry(workId: string): Promise<void>
  work: WorkListItem
}): React.JSX.Element {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')

  useEffect(() => {
    if (focusOnRender) rowRef.current?.focus()
  }, [focusOnRender])

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

  const active = work.status === 'pending' || work.status === 'running'
  const unavailable = work.errorCode === 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE'
  return (
    <tr className={focusOnRender ? 'work-row work-row--focused' : 'work-row'} ref={rowRef} tabIndex={-1}>
      <td><span className="work-title"><strong>{work.title}</strong><small>{work.creatorName}</small></span></td>
      <td>{formatPublishedAt(work.publishedAt)}</td>
      <td>{work.status === 'completed' ? work.likes.toLocaleString('zh-CN') : '—'}</td>
      <td>{work.status === 'completed' ? work.relativeViralIndex ?? '—' : '—'}</td>
      <td>{work.status === 'completed' ? <strong>{work.referenceValueScore ?? '—'}</strong> : '—'}</td>
      <td>
        {work.status === 'completed' ? <HighlightBadges work={work} /> : null}
        {active ? (
          <div className="work-state work-state--running">
            <span><LoaderCircle aria-hidden="true" size={15} />{work.status === 'pending' ? '等待处理' : RUNNING_LABELS[work.stage]}</span>
            <span aria-label={`${work.title}处理进度`} className="indeterminate-progress" role="progressbar"><i /></span>
          </div>
        ) : null}
        {work.status === 'failed' ? (
          <div className="work-state work-state--failed">
            <strong><AlertCircle aria-hidden="true" size={15} />{FAILED_LABELS[work.stage]}</strong>
            <span>{work.errorMessage || '处理失败，请稍后重试。'}</span>
            {retryError ? <span className="form-error" role="alert">{retryError}</span> : null}
          </div>
        ) : null}
      </td>
      <td>
        <div className="row-actions">
          {unavailable ? <Button icon={<Upload size={15} />} onClick={() => onLocalFallback(work)} variant="secondary">改为上传本地视频</Button> : null}
          {work.status === 'failed' && work.retryable ? <Button aria-label={`重试${work.title}`} disabled={retrying} icon={<RotateCcw size={15} />} onClick={() => void retry()} variant="secondary">{retrying ? '正在重试…' : '重试'}</Button> : null}
        </div>
      </td>
    </tr>
  )
}

function HighlightBadges({ work }: { work: WorkListItem }): React.JSX.Element {
  return (
    <div className="inline-badges">
      {work.reasons.includes('absolute_high_likes') ? <StatusBadge tone="success">高点赞</StatusBadge> : null}
      {work.reasons.includes('relative_viral') ? <StatusBadge tone="warning">相对爆款</StatusBadge> : null}
      {work.reasons.includes('high_reference_value') ? <StatusBadge>高借鉴价值</StatusBadge> : null}
      {work.reasons.length === 0 ? <span className="work-state__quiet">已完成</span> : null}
    </div>
  )
}

function formatPublishedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
