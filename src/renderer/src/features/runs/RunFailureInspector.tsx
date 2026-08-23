import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RunFailure, RunStartResult } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { useModalDialog } from '../../hooks/useModalDialog'
import { runFailureDisplayCode, runFailureDisplayMessage } from './runFailureMessage'

const STAGE_LABELS: Record<RunFailure['stage'], string> = {
  discovery: '采集作品', download: '下载视频', transcription: '转成文字', analysis: 'AI 拆解', feishu: '飞书同步'
}

export function RunFailureInspector({ runId, failures, onClose, onRetrySelected, onRetryFeishu }: {
  runId: string | null
  failures: RunFailure[]
  onClose(): void
  onRetrySelected?(creatorIds: string[]): Promise<RunStartResult>
  onRetryFeishu?(): Promise<RunStartResult>
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const closeButton = useRef<HTMLButtonElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const selectAll = useRef<HTMLInputElement>(null)
  const closeIfIdle = useCallback((): void => { if (!submitting) onClose() }, [onClose, submitting])
  useModalDialog({ containerRef: inspector, initialFocusRef: closeButton, onClose: closeIfIdle })

  const creators = [...new Map(failures.flatMap((failure) => failure.stage === 'discovery' && failure.creatorId
    ? [[failure.creatorId, failure.creatorName] as const] : [])).entries()]
  const pureFeishu = failures.length > 0 && failures.every((failure) => failure.stage === 'feishu')
  const hasFeishu = failures.some((failure) => failure.stage === 'feishu')
  const allSelected = creators.length > 0 && selected.size === creators.length
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.size > 0 && !allSelected
  }, [allSelected, selected.size])

  function toggleCreator(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setError('')
  }

  async function submitSelected(): Promise<void> {
    if (!runId || !onRetrySelected || selected.size === 0) return
    setSubmitting(true); setError('')
    try {
      const result = await onRetrySelected([...selected])
      if (result.accepted) onClose(); else setError(result.reason ?? '重新采集未能启动，请稍后重试。')
    } catch {
      setError('重新采集未能启动，请稍后重试。')
    } finally { setSubmitting(false) }
  }

  async function submitFeishu(): Promise<void> {
    if (!onRetryFeishu) return
    setSubmitting(true); setError('')
    try {
      const result = await onRetryFeishu()
      if (result.accepted) onClose(); else setError(result.reason ?? '重新同步未能启动，请稍后重试。')
    } catch { setError('重新同步未能启动，请稍后重试。') } finally { setSubmitting(false) }
  }

  async function copyError(): Promise<void> {
    setError('')
    try {
      await navigator.clipboard?.writeText(failures.map((failure) => [
        failure.creatorName, STAGE_LABELS[failure.stage], runFailureDisplayMessage(failure),
        runFailureDisplayCode(failure), safeOccurredAt(failure.occurredAt)
      ].join('\n')).join('\n\n'))
    } catch {
      setError('复制失败，请稍后重试。')
    }
  }

  return createPortal(<div className="failure-inspector-layer">
    <button aria-label="点击背景关闭失败详情" className="failure-inspector-scrim" disabled={submitting} onClick={closeIfIdle} tabIndex={-1} type="button" />
    <aside aria-labelledby="failure-inspector-title" aria-modal="true" className="failure-inspector" ref={inspector} role="dialog">
      <header><div><span>需要处理</span><h2 id="failure-inspector-title">失败详情</h2><p>共 {failures.length} 个失败项，其中 {creators.length} 位博主可重新采集</p></div><Button aria-label="关闭失败详情" disabled={submitting} icon={<X size={17} />} onClick={closeIfIdle} ref={closeButton} variant="ghost" /></header>
      <section>
        {creators.length > 0 ? <div className="failure-inspector__selection">
          <label><input checked={allSelected} disabled={submitting} onChange={() => setSelected(allSelected ? new Set() : new Set(creators.map(([id]) => id)))} ref={selectAll} type="checkbox" />全选可重采博主</label>
          <div>{creators.map(([id, name]) => <label key={id}><input checked={selected.has(id)} disabled={submitting} onChange={() => toggleCreator(id)} type="checkbox" />{name}</label>)}</div>
        </div> : null}
        <div className="failure-inspector__list">{failures.map((failure, index) => <article key={`${failure.creatorId ?? 'run'}-${failure.stage}-${index}`}>
          <h3>{failure.creatorName}</h3><p>{runFailureDisplayMessage(failure)}</p>
          <dl><dt>失败阶段</dt><dd>{STAGE_LABELS[failure.stage]}</dd><dt>错误代码</dt><dd>{runFailureDisplayCode(failure)}</dd><dt>发生时间</dt><dd>{safeOccurredAt(failure.occurredAt)}</dd></dl>
        </article>)}</div>
        {hasFeishu && !pureFeishu ? <p className="failure-inspector__guidance">飞书同步问题请到设置页检查连接；此处只重新采集所选博主。</p> : null}
        {error ? <p className="failure-inspector__error" role="alert">{error}</p> : null}
        <div className="failure-inspector__actions">
          {creators.length > 0 && onRetrySelected ? <Button disabled={submitting || selected.size === 0} onClick={() => void submitSelected()}>{submitting ? '正在重采…' : '重采所选博主'}</Button> : null}
          {pureFeishu && onRetryFeishu ? <Button disabled={submitting} onClick={() => void submitFeishu()}>{submitting ? '正在同步…' : '重新同步飞书'}</Button> : null}
          <Button disabled={submitting} onClick={() => void copyError()} variant="secondary">复制错误信息</Button>
        </div>
        <span aria-live="polite" className="sr-only">已选择 {selected.size} 位博主</span>
      </section>
    </aside>
  </div>, document.body)
}

function safeOccurredAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return '时间未知'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
}
