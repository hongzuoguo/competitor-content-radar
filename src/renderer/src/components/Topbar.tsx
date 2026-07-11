import { Clock3, Play } from 'lucide-react'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'
import './topbar.css'

export function Topbar(): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar__status">
        <StatusBadge tone="success">服务正常</StatusBadge>
        <span className="topbar__next"><Clock3 size={15} aria-hidden="true" />下次运行 09:00</span>
      </div>
      <Button icon={<Play size={15} fill="currentColor" />}>立即运行</Button>
    </header>
  )
}
