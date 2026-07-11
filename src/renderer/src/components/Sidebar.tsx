import {
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Radar,
  Settings,
  UsersRound,
  Video
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Button } from './Button'
import './sidebar.css'

const NAVIGATION = [
  { to: '/', label: '总览', icon: ChartNoAxesCombined },
  { to: '/creators', label: '博主管理', icon: UsersRound },
  { to: '/works', label: '作品分析', icon: Video },
  { to: '/tasks', label: '任务记录', icon: ClipboardList },
  { to: '/settings', label: '设置', icon: Settings }
] as const

export function Sidebar({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle(): void
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true"><Radar size={19} /></span>
        {!collapsed ? <span className="brand__name">对标内容雷达</span> : null}
      </div>
      <nav className="nav" aria-label="主要导航">
        {NAVIGATION.map(({ to, label, icon: Icon }) => (
          <NavLink
            className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
            end={to === '/'}
            key={to}
            title={collapsed ? label : undefined}
            to={to}
          >
            <Icon size={18} aria-hidden="true" />
            <span className={collapsed ? 'visually-hidden' : ''}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar__health" title={collapsed ? '自动运行正常' : undefined}>
          <span className="health-dot" aria-hidden="true" />
          {!collapsed ? <span>自动运行正常</span> : <span className="visually-hidden">自动运行正常</span>}
        </div>
        <Button
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          className="sidebar__toggle"
          icon={collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          onClick={onToggle}
          variant="ghost"
        >
          {!collapsed ? '收起' : null}
        </Button>
      </div>
    </aside>
  )
}
