import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import type { DashboardRun } from '../../../../shared/ipc-contract'

export function RunStatus({
  run,
  lastRunAt
}: {
  run: DashboardRun
  lastRunAt: string | null
}): React.JSX.Element {
  const completed = run.status === 'completed'
  const title = run.status === 'running'
    ? '今日监控进行中'
    : run.status === 'failed'
      ? '今日监控已暂停'
      : run.status === 'partial'
        ? '今日监控部分完成'
        : completed
          ? '今日监控已完成'
          : '等待首次运行'
  const tone = run.requiresAction || run.status === 'failed'
    ? 'danger'
    : run.status === 'running' || run.status === 'partial'
      ? 'warning'
      : 'success'
  return (
    <section className="run-status" aria-labelledby="run-status-title">
      <div className="run-status__summary">
        <span className="run-status__icon" data-state={completed ? 'complete' : 'running'} aria-hidden="true">
          {completed ? <CheckCircle2 size={21} /> : <LoaderCircle size={21} />}
        </span>
        <div>
          <div className="run-status__title-line">
            <h2 id="run-status-title">{title}</h2>
            <StatusBadge tone={tone}>
              {run.requiresAction ? '需要处理' : run.status === 'running' ? '无需操作' : completed ? '全部完成' : '查看详情'}
            </StatusBadge>
          </div>
          <p aria-live="polite">{run.message}{lastRunAt ? ` · 最近完成 ${new Date(lastRunAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p>
        </div>
      </div>
      <ol className="stage-line" aria-label="处理阶段">
        {run.stages.map((stage, index) => (
          <li data-state={stage.status} key={stage.id}>
            <span aria-hidden="true">{index + 1}</span>{stage.label}
          </li>
        ))}
      </ol>
    </section>
  )
}
