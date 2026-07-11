import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import type { CreatorRow } from './types'

export function CreatorTable({
  creators,
  onToggle
}: {
  creators: CreatorRow[]
  onToggle(id: string): void
}): React.JSX.Element {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>博主</th><th>监控状态</th><th>基线作品</th><th>最近采集</th><th><span className="visually-hidden">操作</span></th></tr></thead>
        <tbody>
          {creators.map((creator) => (
            <tr key={creator.id}>
              <td><div className="identity-cell"><span className="avatar">{creator.name.slice(0, 1)}</span><span><strong>{creator.name}</strong><small>{creator.profileUrl.replace('https://www.douyin.com/user/', '@')}</small></span></div></td>
              <td>{creator.status === 'waiting' ? <StatusBadge tone="warning">等待首次采集</StatusBadge> : creator.status === 'attention' ? <StatusBadge tone="danger">需要登录</StatusBadge> : <StatusBadge tone="success">监控正常</StatusBadge>}</td>
              <td>{creator.works === 0 ? '—' : `${creator.works} 条`}</td>
              <td>{creator.lastRun}</td>
              <td><div className="row-actions"><label className="switch"><input aria-label={`${creator.name}自动监控`} checked={creator.enabled} onChange={() => onToggle(creator.id)} type="checkbox" /><span /></label><Button aria-label={`打开${creator.name}主页`} icon={<ExternalLink size={15} />} onClick={() => void window.desktopApi?.openExternal(creator.profileUrl)} variant="ghost" /><Button aria-label={`${creator.name}更多操作`} icon={<MoreHorizontal size={16} />} variant="ghost" /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
