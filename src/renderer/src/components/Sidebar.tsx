import { ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardList, History, Settings, UsersRound, Video } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Button } from './Button'
import './sidebar.css'

const NAVIGATION = [
  { to: '/', label: '总览', icon: ChartNoAxesCombined },
  { to: '/creators', label: '博主管理', icon: UsersRound },
  { to: '/works', label: '作品分析', icon: Video },
  { to: '/tasks', label: '任务记录', icon: ClipboardList },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/changelog', label: '更新日志', icon: History }
] as const

export function Sidebar({ collapsed, inert = false, mobile = false, onNavigate, onToggle }: { collapsed: boolean; inert?: boolean; mobile?: boolean; onNavigate?(): void; onToggle(): void }): React.JSX.Element {
  return (
    <aside aria-hidden={inert || undefined} className="sidebar" id="primary-navigation" inert={inert}>
      <div className="brand">
        <picture className="brand__picture">
          {!collapsed ? <source media="(min-width: 720px) and (max-width: 1279px)" srcSet="./hitmuse-mark.png" /> : null}
          <img alt="HitMuse" className={`brand__logo${collapsed ? ' brand__logo--collapsed' : ''}`} src={collapsed ? './hitmuse-mark.png' : './hitmuse-logo.png'} />
        </picture>
      </div>
      <nav aria-label="主要导航" className="nav">
        {NAVIGATION.map(({ to, label, icon: Icon }) => (
          <NavLink className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`} end={to === '/'} key={to} onClick={onNavigate} title={label} to={to}>
            <Icon size={18} aria-hidden="true" />
            <span className={collapsed && !mobile ? 'visually-hidden' : 'sidebar__label'}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar__footer">
        {!collapsed ? <div className="sidebar__watermark"><span>抖音、小红书同名：木头AI</span><span>木头AI · 开源软件 · MIT License</span></div> : null}
        <Button aria-label={collapsed ? '展开侧栏' : '收起侧栏'} className="sidebar__toggle" icon={collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />} onClick={onToggle} variant="ghost">{!collapsed ? '收起' : null}</Button>
      </div>
    </aside>
  )
}
