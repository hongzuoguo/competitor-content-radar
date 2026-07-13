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
            <span>{stableWorkErrorMessage(work)}</span>
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

const ERROR_MESSAGES: Record<string, string> = {
  IMPORT_DUPLICATE: '已存在相同作品。',
  DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE: '无法从该抖音作品获取可下载视频，请改为上传本地视频。',
  DOUYIN_MEDIA_URL_MISSING: '无法从该抖音作品获取可下载视频，请改为上传本地视频。',
  APP_INTERRUPTED: '应用上次在处理期间退出，请重试此任务。',
  SOURCE_INPUT_REQUIRED: '导入来源未准备完成，请重新导入。',
  IMPORT_PREPARATION_MISSING: '导入来源未准备完成，请重新导入。',
  FILE_NOT_FOUND: '无法读取视频文件，请确认文件仍在原位置。',
  UNSUPPORTED_VIDEO_FORMAT: '暂不支持这个视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。',
  INSUFFICIENT_DISK_SPACE: '磁盘空间不足，请清理空间后重新导入。',
  MEDIA_COPY_FAILED: '视频准备失败，请确认文件仍可读取并检查磁盘空间。',
  MEDIA_MISSING: '视频文件不可用，请重新导入。',
  DOUYIN_DOWNLOAD_FAILED: '抖音视频下载失败，请稍后重试或改为上传本地视频。',
  AUDIO_EXTRACTION_FAILED: '音频提取失败，请确认视频可以正常播放后重试。',
  FFMPEG_FAILED: '音频提取失败，请确认视频可以正常播放后重试。',
  AUDIO_MISSING: '音频文件不可用，请重试此任务。',
  ASR_FAILED: '文字转写失败，请稍后重试。',
  TRANSCRIPTION_FAILED: '文字转写失败，请稍后重试。',
  TRANSCRIPT_MISSING: '文字稿不可用，请重试此任务。',
  AI_FAILED: 'AI 服务暂时不可用，请稍后重试。',
  AI_TIMEOUT: 'AI 服务暂时不可用，请稍后重试。',
  ANALYSIS_FAILED: 'AI 服务暂时不可用，请稍后重试。'
}

export function stableWorkErrorMessage(work: Pick<WorkListItem, 'errorCode' | 'stage'>): string {
  if (work.errorCode && ERROR_MESSAGES[work.errorCode]) return ERROR_MESSAGES[work.errorCode]
  const fallback: Record<WorkListItem['stage'], string> = {
    discovered: '视频准备失败，请稍后重试或重新导入。',
    downloaded: '音频提取失败，请确认视频可以正常播放后重试。',
    audio_extracted: '文字转写失败，请稍后重试。',
    transcribed: 'AI 服务暂时不可用，请稍后重试。',
    analyzed: '结果保存失败，请稍后重试。',
    synced: '同步失败，请稍后重试。',
    completed: '任务未能完成，请稍后重试。'
  }
  return fallback[work.stage]
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
