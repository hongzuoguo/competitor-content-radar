import { Bot, Check, Cloud, Download, ScanSearch } from 'lucide-react'

const SERVICES = [
  { label: '抖音登录', detail: '会话有效', icon: ScanSearch },
  { label: '视频下载', detail: '内置组件可用', icon: Download },
  { label: '本地转写', detail: '模型已就绪', icon: Check },
  { label: 'AI 拆解', detail: 'Qwen 3.7 Plus', icon: Bot },
  { label: '飞书同步', detail: '授权有效', icon: Cloud }
]

export function TaskHealth(): React.JSX.Element {
  return (
    <section className="task-health" aria-labelledby="task-health-title">
      <div className="section-heading"><div><h2 id="task-health-title">运行环境</h2><p>自动流程所需连接</p></div></div>
      <ul>
        {SERVICES.map(({ label, detail, icon: Icon }) => (
          <li key={label}><span className="task-health__icon"><Icon size={16} /></span><span><strong>{label}</strong><small>{detail}</small></span><span className="task-health__ok">正常</span></li>
        ))}
      </ul>
    </section>
  )
}
