import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import './workspace-pages.css'

const TASKS = [
  { id: 'task-1', time: '今天 09:00', kind: '每日监控', works: 12, stage: '全部完成', status: 'completed' as const, detail: '11 条完成拆解，1 条无新增内容' },
  { id: 'task-2', time: '昨天 09:00', kind: '每日监控', works: 9, stage: 'AI 拆解', status: 'failed' as const, detail: 'AI 账户余额不足' },
  { id: 'task-3', time: '周一 09:30', kind: '周报生成', works: 42, stage: '飞书同步', status: 'completed' as const, detail: '周报已写入飞书' }
]

export function TasksPage({ onRetry = () => undefined }: { onRetry?: (id: string) => void }): React.JSX.Element {
  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>任务记录</h1><p>查看每次自动运行的阶段、结果和需要处理的问题。</p></div></header>
      <section className="task-summary"><div><strong>最近 7 天</strong><span>7 次自动运行</span></div><div><strong>97.8%</strong><span>作品处理成功率</span></div><div><strong>1</strong><span>需要人工处理</span></div></section>
      <div className="task-list">{TASKS.map((task) => <article className="task-row" data-status={task.status} key={task.id}><span className="task-row__icon" aria-hidden="true">{task.status === 'completed' ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</span><div className="task-row__identity"><strong>{task.kind}</strong><span>{task.time} · {task.works} 条作品</span></div><div><span className="task-row__label">最后阶段</span><strong>{task.stage}</strong></div><div><span className="task-row__label">结果</span><span>{task.detail}</span></div><div>{task.status === 'completed' ? <StatusBadge tone="success">完成</StatusBadge> : <Button aria-label="从 AI 拆解阶段重试" icon={<RotateCcw size={15} />} onClick={() => onRetry(task.id)} variant="secondary">重试</Button>}</div></article>)}</div>
    </div>
  )
}
