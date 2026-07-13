import { ExternalLink, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { CreatorView } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { ImportWorkDialog, type ImportAcceptedResult } from '../features/works/ImportWorkDialog'
import './workspace-pages.css'

const WORKS = [
  { id: '1', creator: '增长实验室', title: '为什么你的内容看起来很努力，却没有增长', published: '今天 08:20', likes: 18642, viral: 238, score: 91, reasons: ['high-likes', 'viral', 'value'] },
  { id: '2', creator: '内容操盘手阿哲', title: '一个选题能不能爆，发布前看这三个信号', published: '昨天 23:40', likes: 8930, viral: 176, score: 88, reasons: ['viral', 'value'] },
  { id: '3', creator: '短视频观察局', title: '别急着追热点，先判断它和你的用户有没有关系', published: '昨天 21:10', likes: 12706, viral: 132, score: 84, reasons: ['high-likes', 'value'] }
]

export function WorksPage({ onImportAccepted }: { onImportAccepted?(result: ImportAcceptedResult): void } = {}): React.JSX.Element {
  const [filter, setFilter] = useState<'all' | 'high-likes' | 'viral' | 'value'>('all')
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [creators, setCreators] = useState<CreatorView[]>([])
  const [message, setMessage] = useState('')
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const works = useMemo(() => WORKS.filter((work) => (filter === 'all' || work.reasons.includes(filter)) && `${work.creator}${work.title}`.includes(query)), [filter, query])

  function openImport(): void {
    setImportOpen(true)
    setMessage('')
    if (window.desktopApi) void window.desktopApi.listCreators().then(setCreators).catch(() => setCreators([]))
  }

  function closeImport(): void {
    setImportOpen(false)
    requestAnimationFrame(() => importButtonRef.current?.focus())
  }

  function acceptImport(result: ImportAcceptedResult): void {
    closeImport()
    setMessage(result.existingWorkId ? '已找到重复作品，正在打开原分析结果' : '任务已启动，请到作品分析查看进度')
    onImportAccepted?.(result)
  }

  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>作品分析</h1><p>按表现信号筛选作品，沉淀可复用的选题、钩子和结构。</p></div><div className="page-heading__actions"><Button icon={<SlidersHorizontal size={16} />} variant="secondary">管理视图</Button><Button icon={<Plus size={16} />} onClick={openImport} ref={importButtonRef}>导入作品</Button></div></header>
      {message ? <p aria-live="polite" className="page-message">{message}</p> : null}
      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="作品筛选">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')} type="button">全部</button>
          <button aria-pressed={filter === 'high-likes'} onClick={() => setFilter('high-likes')} type="button">只看高点赞</button>
          <button aria-pressed={filter === 'viral'} onClick={() => setFilter('viral')} type="button">相对爆款</button>
          <button aria-pressed={filter === 'value'} onClick={() => setFilter('value')} type="button">高借鉴价值</button>
        </div>
        <label className="search-field"><Search size={15} aria-hidden="true" /><span className="visually-hidden">搜索作品</span><input aria-label="搜索作品" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或博主" value={query} /></label>
      </div>
      <div className="table-wrap"><table className="data-table works-table"><thead><tr><th>作品</th><th>发布时间</th><th>点赞量</th><th>相对爆款</th><th>借鉴评分</th><th>判断</th><th /></tr></thead><tbody>{works.map((work) => <tr key={work.id}><td><span className="work-title"><strong>{work.title}</strong><small>{work.creator}</small></span></td><td>{work.published}</td><td>{work.likes.toLocaleString('zh-CN')}</td><td>{work.viral}</td><td><strong>{work.score}</strong></td><td><div className="inline-badges">{work.reasons.includes('high-likes') ? <StatusBadge tone="success">高点赞</StatusBadge> : null}{work.reasons.includes('viral') ? <StatusBadge tone="warning">相对爆款</StatusBadge> : null}</div></td><td><Button aria-label={`打开${work.title}`} icon={<ExternalLink size={15} />} variant="ghost" /></td></tr>)}</tbody></table></div>
      {importOpen ? <ImportWorkDialog creators={creators} onAccepted={acceptImport} onClose={closeImport} /> : null}
    </div>
  )
}
