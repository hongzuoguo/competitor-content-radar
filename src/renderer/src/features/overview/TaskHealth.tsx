import { AlertCircle, Bot, Check, Cloud, Download, ScanSearch } from 'lucide-react'
import type { DashboardService } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'

const ICONS: Record<string, typeof Check> = {
  douyin: ScanSearch,
  download: Download,
  transcription: Check,
  ai: Bot,
  feishu: Cloud
}

export function TaskHealth({ services, onAction }: { services: DashboardService[]; onAction?: (service: DashboardService) => void }): React.JSX.Element {
  return (
    <section className="task-health" aria-labelledby="task-health-title">
      <div className="section-heading"><div><h2 id="task-health-title">运行环境</h2><p>自动流程所需连接</p></div></div>
      <ul>
        {services.map((service) => {
          const Icon = service.status === 'healthy' ? (ICONS[service.id] ?? Check) : AlertCircle
          return (
            <li data-status={service.status} key={service.id}>
              <span className="task-health__icon"><Icon size={16} /></span>
              <span><strong>{service.label}</strong><small>{service.detail}</small></span>
              {service.actionLabel ? <Button onClick={() => onAction?.(service)} variant="ghost">{service.actionLabel}</Button> : <span className="task-health__ok">正常</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
