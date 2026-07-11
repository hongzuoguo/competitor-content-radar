import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'

export function RunStatus({
  newWorks,
  analyzedWorks,
  lastRunAt
}: {
  newWorks: number
  analyzedWorks: number
  lastRunAt: string | null
}): React.JSX.Element {
  const pending = Math.max(0, newWorks - analyzedWorks)
  const completed = pending === 0
  const stages = ['采集', '下载', '转写', 'AI 拆解', '飞书同步']
  return (
    <section className="run-status" aria-labelledby="run-status-title">
      <div className="run-status__summary">
        <span className="run-status__icon" data-state={completed ? 'complete' : 'running'} aria-hidden="true">
          {completed ? <CheckCircle2 size={21} /> : <LoaderCircle size={21} />}
        </span>
        <div>
          <div className="run-status__title-line">
            <h2 id="run-status-title">今日监控{completed ? '已完成' : '仍在处理'}</h2>
            <StatusBadge tone={completed ? 'success' : 'warning'}>
              {completed ? '全部完成' : `${pending} 条待处理`}
            </StatusBadge>
          </div>
          <p>{lastRunAt ? `最近完成 ${new Date(lastRunAt).toLocaleString('zh-CN', { hour12: false })}` : '尚未完成首次运行'}</p>
        </div>
      </div>
      <ol className="stage-line" aria-label="处理阶段">
        {stages.map((stage, index) => (
          <li data-state={completed || index < 3 ? 'complete' : index === 3 ? 'running' : 'pending'} key={stage}>
            <span aria-hidden="true">{index + 1}</span>{stage}
          </li>
        ))}
      </ol>
    </section>
  )
}
