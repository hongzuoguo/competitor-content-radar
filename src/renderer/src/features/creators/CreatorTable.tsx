import { ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import type { CreatorRow } from './types'

export function CreatorTable({
  creators,
  onToggle,
  onDelete
}: {
  creators: CreatorRow[]
  onToggle(id: string): void
  onDelete(creator: CreatorRow): void
}): React.JSX.Element {
  return (
    <div className="table-wrap">
      <table className="data-table creator-table">
        <thead><tr><th>博主</th><th>监控状态</th><th>基线作品</th><th>最近采集</th><th><span className="visually-hidden">操作</span></th></tr></thead>
        <tbody>
          {creators.map((creator) => (
            <tr key={creator.id}>
              <td data-label="博主"><div className="identity-cell"><span className="avatar">{creator.name.slice(0, 1)}</span><span><strong>{creator.name}</strong><small>{creator.profileUrl.replace('https://www.douyin.com/user/', '@')}</small></span></div></td>
              <td data-label="监控状态">{creator.status === 'waiting' ? <StatusBadge tone="warning">等待首次采集</StatusBadge> : creator.status === 'attention' ? <StatusBadge tone="danger">需要登录</StatusBadge> : <StatusBadge tone="success">监控正常</StatusBadge>}</td>
              <td data-label="基线作品">{creator.works === 0 ? '—' : `${creator.works} 条`}</td>
              <td data-label="最近采集">{creator.lastRun}</td>
              <td data-label="操作"><div className="row-actions"><label className="switch"><input aria-label={`${creator.name}自动监控`} checked={creator.enabled} onChange={() => onToggle(creator.id)} type="checkbox" /><span /></label><Button aria-label={`打开${creator.name}主页`} icon={<ExternalLink size={15} />} onClick={() => void window.desktopApi?.openExternal(creator.profileUrl)} variant="ghost" /><Button aria-label={`删除${creator.name}`} icon={<Trash2 size={16} />} onClick={() => onDelete(creator)} variant="ghost" /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
