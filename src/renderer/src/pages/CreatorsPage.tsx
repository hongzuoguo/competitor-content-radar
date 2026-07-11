import { useState } from 'react'
import { CreatorForm } from '../features/creators/CreatorForm'
import { CreatorTable } from '../features/creators/CreatorTable'
import type { CreatorRow } from '../features/creators/types'
import './workspace-pages.css'

const DEFAULT_CREATORS: CreatorRow[] = [
  { id: '1', name: '增长实验室', profileUrl: 'https://www.douyin.com/user/growth', enabled: true, works: 30, lastRun: '今天 09:02', status: 'ready' },
  { id: '2', name: '内容操盘手阿哲', profileUrl: 'https://www.douyin.com/user/azhe', enabled: true, works: 30, lastRun: '今天 09:04', status: 'ready' },
  { id: '3', name: '短视频观察局', profileUrl: 'https://www.douyin.com/user/observer', enabled: true, works: 28, lastRun: '今天 09:06', status: 'ready' }
]

export function CreatorsPage({ initialCreators = DEFAULT_CREATORS }: { initialCreators?: CreatorRow[] }): React.JSX.Element {
  const [creators, setCreators] = useState(initialCreators)
  const atLimit = creators.length >= 10

  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>博主管理</h1><p>添加需要长期观察的抖音博主，最多 10 位。</p></div><span className="capacity">{creators.length} / 10</span></header>
      <CreatorForm disabled={atLimit} onAdd={(profileUrl) => setCreators((current) => [...current, { id: crypto.randomUUID(), name: '新博主', profileUrl, enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting' }])} />
      {atLimit ? <p className="limit-note"><strong>已达到 10 位上限</strong><span>；暂停或删除现有博主后才能继续添加。</span></p> : null}
      <section className="page-section"><div className="section-heading"><div><h2>正在监控</h2><p>关闭监控不会删除历史分析数据</p></div><span>{creators.filter((creator) => creator.enabled).length} 位启用</span></div><CreatorTable creators={creators} onToggle={(id) => setCreators((current) => current.map((creator) => creator.id === id ? { ...creator, enabled: !creator.enabled } : creator))} /></section>
    </div>
  )
}
