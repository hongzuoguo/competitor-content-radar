import { useEffect, useRef, useState } from 'react'
import { CreatorForm } from '../features/creators/CreatorForm'
import { CreatorTable } from '../features/creators/CreatorTable'
import type { CreatorRow } from '../features/creators/types'
import { Button } from '../components/Button'
import './workspace-pages.css'

const PREVIEW_CREATORS: CreatorRow[] = [
  { id: '1', name: '增长实验室', profileUrl: 'https://www.douyin.com/user/growth', enabled: true, works: 30, lastRun: '今天 09:02', status: 'ready' },
  { id: '2', name: '内容操盘手阿哲', profileUrl: 'https://www.douyin.com/user/azhe', enabled: true, works: 30, lastRun: '今天 09:04', status: 'ready' },
  { id: '3', name: '短视频观察局', profileUrl: 'https://www.douyin.com/user/observer', enabled: true, works: 28, lastRun: '今天 09:06', status: 'ready' }
]

export function CreatorsPage({ initialCreators }: { initialCreators?: CreatorRow[] }): React.JSX.Element {
  const preview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
  const [creators, setCreators] = useState(initialCreators ?? (preview ? PREVIEW_CREATORS : []))
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CreatorRow | null>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const atLimit = creators.length >= 10

  useEffect(() => {
    if (initialCreators === undefined && !preview && window.desktopApi) {
      void window.desktopApi.listCreators().then(setCreators).catch(() => setMessage('博主列表加载失败，请稍后重试。'))
    }
  }, [initialCreators, preview])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!pendingDelete || !dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [pendingDelete])

  async function addCreator(profileUrl: string): Promise<void> {
    if (!window.desktopApi) {
      setCreators((current) => [...current, { id: crypto.randomUUID(), name: '新博主', profileUrl, enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting' }])
      return
    }
    setMessage('正在添加博主…')
    try {
      const creator = await window.desktopApi.addCreator(profileUrl)
      setCreators((current) => [...current, creator])
      setMessage('博主已添加，将在下次运行时采集。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败，请检查主页地址。')
    }
  }

  async function toggleCreator(id: string): Promise<void> {
    const creator = creators.find((item) => item.id === id)
    if (!creator) return
    const enabled = !creator.enabled
    setCreators((current) => current.map((item) => item.id === id ? { ...item, enabled } : item))
    try {
      await window.desktopApi?.toggleCreator(id, enabled)
    } catch {
      setCreators((current) => current.map((item) => item.id === id ? { ...item, enabled: !enabled } : item))
      setMessage('监控状态保存失败，已恢复原状态。')
    }
  }

  async function deleteCreator(): Promise<void> {
    if (!pendingDelete) return
    const creator = pendingDelete
    setPendingDelete(null)
    if (!window.desktopApi) {
      setCreators((current) => current.filter((item) => item.id !== creator.id))
      return
    }
    setMessage('正在删除博主…')
    try {
      await window.desktopApi.deleteCreator(creator.id)
      setCreators((current) => current.filter((item) => item.id !== creator.id))
      setMessage(`${creator.name}及其历史数据已删除。`)
    } catch {
      setMessage('删除失败，请稍后重试。')
    }
  }

  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>博主管理</h1><p>添加需要长期观察的抖音博主，最多 10 位。</p></div><span className="capacity">{creators.length} / 10</span></header>
      <CreatorForm disabled={atLimit} onAdd={(profileUrl) => void addCreator(profileUrl)} />
      <p aria-live="polite" className="form-help">{message}</p>
      {atLimit ? <p className="limit-note"><strong>已达到 10 位上限</strong><span>；暂停或删除现有博主后才能继续添加。</span></p> : null}
      <section className="page-section"><div className="section-heading"><div><h2>正在监控</h2><p>关闭监控不会删除历史分析数据</p></div><span>{creators.filter((creator) => creator.enabled).length} 位启用</span></div><CreatorTable creators={creators} onDelete={setPendingDelete} onToggle={(id) => void toggleCreator(id)} /></section>
      {pendingDelete ? (
        <dialog aria-labelledby="delete-creator-title" className="confirm-dialog" onCancel={() => setPendingDelete(null)} ref={deleteDialogRef}>
          <h2 id="delete-creator-title">删除{pendingDelete.name}？</h2>
          <p>该博主的作品、文字稿、分析结果和指标快照会一并永久删除。若只想暂停采集，请关闭监控开关。</p>
          <div className="confirm-dialog__actions">
            <Button autoFocus onClick={() => setPendingDelete(null)} variant="secondary">取消</Button>
            <Button onClick={() => void deleteCreator()} variant="danger">确认删除</Button>
          </div>
        </dialog>
      ) : null}
    </div>
  )
}
