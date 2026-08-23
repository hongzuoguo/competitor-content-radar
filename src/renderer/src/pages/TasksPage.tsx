import { AlertTriangle, CheckCircle2, LoaderCircle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardData, RunFailure, RunHistoryItem } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { RunStatus } from '../features/overview/RunStatus'
import { TaskHealth } from '../features/overview/TaskHealth'
import { RunFailureInspector } from '../features/runs/RunFailureInspector'
import { formatRunAnalysisSummary, formatRunCollectionSummary, formatRunSuccessLabel } from '../features/runs/run-copy'
import './overview.css'
import './workspace-pages.css'

const KIND_LABELS: Record<RunHistoryItem['kind'], string> = {
  daily: '每日监控', manual: '手动运行', catch_up: '补采任务'
}

export function TasksPage(): React.JSX.Element {
  const [runs, setRuns] = useState<RunHistoryItem[]>([])
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [selected, setSelected] = useState<{ runId: string | null; failures: RunFailure[] } | null>(null)
  const failureTrigger = useRef<HTMLButtonElement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<RunHistoryItem | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current
    let request: Promise<void>
    request = Promise.all([window.desktopApi.listRuns(), window.desktopApi.getDashboard()])
      .then(([nextRuns, nextDashboard]) => {
        setRuns(nextRuns)
        setDashboard(nextDashboard)
      })
      .finally(() => {
        if (refreshInFlight.current === request) refreshInFlight.current = null
      })
    refreshInFlight.current = request
    return request
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (dashboard?.run.status !== 'running') return
    const timer = window.setInterval(() => { void refresh() }, 1_000)
    return () => window.clearInterval(timer)
  }, [dashboard?.run.status, refresh])

  useEffect(() => {
    const handleRunStarted = (): void => {
      void refresh()
    }

    window.addEventListener('content-radar:run-started', handleRunStarted)
    return () => window.removeEventListener('content-radar:run-started', handleRunStarted)
  }, [refresh])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!pendingDelete || !dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [pendingDelete])

  async function retrySelected(runId: string, creatorIds: string[]): Promise<{ accepted: boolean; reason?: string }> {
    const result = await window.desktopApi.retryFailedCreators({ runId, creatorIds })
    if (result.accepted) void refresh().catch(() => undefined)
    return result
  }

  async function retryFeishu(runId: string): Promise<{ accepted: boolean; reason?: string }> {
    const result = await window.desktopApi.retryRun(runId)
    if (result.accepted) void refresh().catch(() => undefined)
    return result
  }

  function closeFailureInspector(): void {
    setSelected(null)
    requestAnimationFrame(() => failureTrigger.current?.focus())
  }

  function requestDelete(run: RunHistoryItem): void {
    setDeleteError('')
    setPendingDelete(run)
  }

  function cancelDelete(): void {
    deleteDialogRef.current?.close()
    setPendingDelete(null)
    setDeleteError('')
  }

  async function deleteRun(): Promise<void> {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await window.desktopApi.deleteRun(pendingDelete.id)
      await refresh()
      cancelDelete()
    } catch {
      setDeleteError('删除失败，请稍后重试。运行中的任务不能删除。')
    } finally {
      setDeleting(false)
    }
  }

  const needsAction = runs.filter((run) => run.failures.length > 0).length
  const processed = runs.reduce((sum, run) => sum + run.selectedForAnalysis, 0)
  const analyzed = runs.reduce((sum, run) => sum + run.analyzed, 0)
  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>任务记录</h1><p>查看每次自动运行的阶段、结果和需要处理的问题。</p></div></header>
      {dashboard ? <section className="task-status-surface" aria-label="当前运行">
        <div className="task-surface-heading"><div><h2>当前运行</h2><p>自动流程的连接状态、进度和恢复入口。</p></div></div>
        <div className="task-status-surface__body">
        {dashboard.services.length > 0 ? <TaskHealth onAction={(service) => service.id === 'douyin' ? void window.desktopApi.loginDouyin() : window.location.hash = '#/settings'} services={dashboard.services} /> : null}
        <RunStatus lastRunAt={dashboard.lastRunAt} onInspect={(trigger) => {
          const failures = dashboard.run.failures ?? []
          if (failures.length > 0) { failureTrigger.current = trigger; setSelected({ runId: dashboard.run.runId, failures }) }
        }} run={dashboard.run} />
        </div>
      </section> : null}
      <section className="task-history-surface" aria-label="运行记录">
      <div className="task-surface-heading"><div><h2>运行记录</h2><p>按最近运行顺序保留采集、拆解与失败位置。</p></div><span>{runs.length} 条</span></div>
      <section className="task-summary"><div><strong>{runs.length}</strong><span>真实运行记录</span></div><div><strong>{processed ? `${Math.round(analyzed / processed * 100)}%` : '—'}</strong><span>作品分析完成率</span></div><div><strong>{needsAction}</strong><span>需要人工处理</span></div></section>
      {loading ? <p>正在加载任务记录…</p> : null}
      {!loading && runs.length === 0 ? <p>还没有运行记录。</p> : null}
      <div className="task-list">{runs.map((run) => {
        const failure = run.failures[0]
        return <article className="task-row" data-status={run.status} key={run.id}>
          <span className="task-row__icon" aria-hidden="true">{failure ? <AlertTriangle size={19} /> : run.status === 'running' ? <LoaderCircle size={19} /> : <CheckCircle2 size={19} />}</span>
          <div className="task-row__identity"><strong>{KIND_LABELS[run.kind]}</strong><span>{new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })} · {formatRunCollectionSummary(run)}</span></div>
          <div><span className="task-row__label">拆解结果</span><span>{formatRunAnalysisSummary(run)}</span></div>
          <div className="task-row__actions">{failure ? <Button onClick={(event) => { failureTrigger.current = event.currentTarget; setSelected({ runId: run.id, failures: run.failures }) }} variant="secondary">查看失败详情（{run.failures.length}）</Button> : <StatusBadge tone={run.status === 'running' ? 'warning' : 'success'}>{formatRunSuccessLabel(run)}</StatusBadge>}{run.status !== 'running' ? <Button aria-label="删除运行记录" icon={<Trash2 size={15} />} onClick={() => requestDelete(run)} variant="ghost">删除记录</Button> : null}</div>
        </article>
      })}</div>
      </section>
      {selected ? <RunFailureInspector failures={selected.failures} onClose={closeFailureInspector} runId={selected.runId} {...(selected.runId ? {
        onRetrySelected: (creatorIds: string[]) => retrySelected(selected.runId!, creatorIds),
        onRetryFeishu: () => retryFeishu(selected.runId!)
      } : {})} /> : null}
      {pendingDelete ? <dialog aria-labelledby="delete-run-title" className="confirm-dialog" onCancel={(event) => { event.preventDefault(); cancelDelete() }} ref={deleteDialogRef}>
        <h2 id="delete-run-title">删除这条运行记录？</h2>
        <p>只删除本次运行记录，不会删除已采集作品、文字稿、AI 拆解、本周榜单或飞书数据。</p>
        {deleteError ? <p className="confirm-dialog__error" role="alert">{deleteError}</p> : null}
        <div className="confirm-dialog__actions"><Button disabled={deleting} onClick={cancelDelete} variant="secondary">取消</Button><Button disabled={deleting} onClick={() => void deleteRun()} variant="danger">{deleting ? '正在删除…' : '确认删除记录'}</Button></div>
      </dialog> : null}
    </div>
  )
}
