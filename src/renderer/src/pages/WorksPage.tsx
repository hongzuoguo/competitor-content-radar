import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CreatorView, ImportStartResult, WorkListItem } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { ImportWorkDialog, type CreatorLoadState } from '../features/works/ImportWorkDialog'
import { WorkStatusRow } from '../features/works/WorkStatusRow'
import './workspace-pages.css'

type WorkFilter = 'all' | 'high-likes' | 'viral' | 'value' | 'processing' | 'failed'
type LoadState = 'loading' | 'ready' | 'failed'

export function WorksPage({ onImportAccepted, requestedWorkId }: {
  onImportAccepted?(result: ImportStartResult): void
  requestedWorkId?: string
} = {}): React.JSX.Element {
  const [filter, setFilter] = useState<WorkFilter>('all')
  const [query, setQuery] = useState('')
  const [allWorks, setAllWorks] = useState<WorkListItem[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [importOpen, setImportOpen] = useState(false)
  const [initialCreatorId, setInitialCreatorId] = useState<string | null>()
  const [initialLocalPath, setInitialLocalPath] = useState<string>()
  const [creators, setCreators] = useState<CreatorView[]>([])
  const [creatorLoadState, setCreatorLoadState] = useState<CreatorLoadState>('loading')
  const [message, setMessage] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const [focusedWorkId, setFocusedWorkId] = useState<string>()
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const mountedRef = useRef(false)
  const pendingImportIdRef = useRef<string | undefined>(undefined)
  const focusRestoreFrameRef = useRef<number | null>(null)
  const refreshRunningRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const queuedDuplicateCandidateRef = useRef<string | undefined>(undefined)
  const hasSuccessfulLoadRef = useRef(false)
  const handledFocusRequestRef = useRef<string | undefined>(undefined)

  const cancelFocusRestore = useCallback((): void => {
    if (focusRestoreFrameRef.current === null) return
    cancelAnimationFrame(focusRestoreFrameRef.current)
    focusRestoreFrameRef.current = null
  }, [])

  const refreshWorks = useCallback(async (showLoading = false, duplicateCandidateId?: string): Promise<void> => {
    if (!mountedRef.current) return
    if (refreshRunningRef.current) {
      refreshQueuedRef.current = true
      if (duplicateCandidateId && duplicateCandidateId === pendingImportIdRef.current) {
        queuedDuplicateCandidateRef.current = duplicateCandidateId
      }
      return
    }
    refreshRunningRef.current = true
    let nextShowLoading = showLoading
    let nextDuplicateCandidateId = duplicateCandidateId
    try {
      do {
        refreshQueuedRef.current = false
        queuedDuplicateCandidateRef.current = undefined
        if (nextShowLoading) setLoadState('loading')
        try {
          const nextWorks = window.desktopApi && typeof window.desktopApi.listWorks === 'function'
            ? await window.desktopApi.listWorks()
            : []
          if (!mountedRef.current) return
          setAllWorks(nextWorks)
          setLoadState('ready')
          setRefreshWarning('')
          hasSuccessfulLoadRef.current = true
          const duplicate = pendingImportIdRef.current && nextDuplicateCandidateId === pendingImportIdRef.current
            ? nextWorks.find((work) => work.id === nextDuplicateCandidateId && work.errorCode === 'IMPORT_DUPLICATE' && work.existingWorkId)
            : undefined
          if (duplicate?.existingWorkId && nextWorks.some((work) => work.id === duplicate.existingWorkId)) {
            pendingImportIdRef.current = undefined
            cancelFocusRestore()
            setFocusedWorkId(duplicate.existingWorkId)
            setFilter('all')
            setQuery('')
            setMessage('已存在相同作品，已为你定位到原作品。')
          }
        } catch {
          if (!mountedRef.current) return
          if (hasSuccessfulLoadRef.current) setRefreshWarning('作品刷新失败，已保留上次结果。')
          else setLoadState('failed')
        }
        nextShowLoading = false
        nextDuplicateCandidateId = queuedDuplicateCandidateRef.current
      } while (mountedRef.current && refreshQueuedRef.current)
    } finally {
      refreshRunningRef.current = false
    }
  }, [cancelFocusRestore])

  useEffect(() => {
    mountedRef.current = true
    void refreshWorks(true)
    const unsubscribe = typeof window.desktopApi?.onWorkStateChanged === 'function'
      ? window.desktopApi.onWorkStateChanged((workId) => { void refreshWorks(false, workId) })
      : () => undefined
    return () => {
      mountedRef.current = false
      refreshQueuedRef.current = false
      cancelFocusRestore()
      unsubscribe()
    }
  }, [cancelFocusRestore, refreshWorks])

  useEffect(() => {
    if (!requestedWorkId || handledFocusRequestRef.current === requestedWorkId) return
    if (!allWorks.some((work) => work.id === requestedWorkId && work.errorCode !== 'IMPORT_DUPLICATE')) return
    handledFocusRequestRef.current = requestedWorkId
    setFilter('all')
    setQuery('')
    setFocusedWorkId(requestedWorkId)
  }, [allWorks, requestedWorkId])

  const nonDuplicateWorks = useMemo(() => allWorks.filter((work) => work.errorCode !== 'IMPORT_DUPLICATE'), [allWorks])
  const works = useMemo(() => nonDuplicateWorks.filter((work) => {
    if (!`${work.creatorName}${work.title}`.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN'))) return false
    if (filter === 'processing') return work.status === 'pending' || work.status === 'running'
    if (filter === 'failed') return work.status === 'failed'
    if (filter === 'high-likes') return work.status === 'completed' && work.reasons.includes('absolute_high_likes')
    if (filter === 'viral') return work.status === 'completed' && work.reasons.includes('relative_viral')
    if (filter === 'value') return work.status === 'completed' && work.reasons.includes('high_reference_value')
    return true
  }), [filter, nonDuplicateWorks, query])

  function openImport(options: { creatorId?: string | null; localPath?: string } = {}): void {
    cancelFocusRestore()
    setInitialCreatorId(options.creatorId)
    setInitialLocalPath(options.localPath)
    setImportOpen(true)
    setMessage('')
    void loadCreators()
  }

  async function loadCreators(): Promise<void> {
    setCreatorLoadState('loading')
    setCreators([])
    if (!window.desktopApi) { setCreatorLoadState('failed'); return }
    try {
      setCreators(await window.desktopApi.listCreators())
      setCreatorLoadState('ready')
    } catch {
      setCreatorLoadState('failed')
    }
  }

  function closeImport(): void {
    setImportOpen(false)
    cancelFocusRestore()
    focusRestoreFrameRef.current = requestAnimationFrame(() => {
      focusRestoreFrameRef.current = null
      importButtonRef.current?.focus()
    })
  }

  function acceptImport(result: ImportStartResult): void {
    pendingImportIdRef.current = result.workId
    closeImport()
    setMessage('任务已启动，请到作品分析查看进度')
    void refreshWorks(false, result.workId)
    onImportAccepted?.(result)
  }

  async function retryImport(workId: string): Promise<void> {
    await window.desktopApi.retryImport(workId)
    setMessage('任务已重新启动。')
    await refreshWorks()
  }

  async function chooseLocalFallback(work: WorkListItem): Promise<void> {
    try {
      const path = await window.desktopApi.pickLocalVideo()
      if (path) openImport({ creatorId: work.creatorId, localPath: path })
    } catch {
      setMessage('无法打开文件选择器，请稍后重试。')
    }
  }

  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>作品分析</h1><p>按表现信号筛选作品，沉淀可复用的选题、钩子和结构。</p></div><div className="page-heading__actions"><Button icon={<SlidersHorizontal size={16} />} variant="secondary">管理视图</Button><Button icon={<Plus size={16} />} onClick={() => openImport()} ref={importButtonRef}>导入作品</Button></div></header>
      {message ? <p aria-live="polite" className="page-message">{message}</p> : null}
      {refreshWarning ? <p aria-live="polite" className="page-message">{refreshWarning}</p> : null}
      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="作品筛选">
          <FilterButton current={filter} id="all" onSelect={setFilter}>全部</FilterButton>
          <FilterButton current={filter} id="high-likes" onSelect={setFilter}>只看高点赞</FilterButton>
          <FilterButton current={filter} id="viral" onSelect={setFilter}>相对爆款</FilterButton>
          <FilterButton current={filter} id="value" onSelect={setFilter}>高借鉴价值</FilterButton>
          <FilterButton current={filter} id="processing" onSelect={setFilter}>处理中</FilterButton>
          <FilterButton current={filter} id="failed" onSelect={setFilter}>失败</FilterButton>
        </div>
        <label className="search-field"><Search size={15} aria-hidden="true" /><span className="visually-hidden">搜索作品</span><input aria-label="搜索作品" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或博主" value={query} /></label>
      </div>

      {loadState === 'loading' ? <WorksLoading /> : null}
      {loadState === 'failed' ? <div className="works-state" role="alert"><strong>作品加载失败</strong><span>无法读取本地作品记录，请稍后重试。</span><Button onClick={() => void refreshWorks(true)} variant="secondary">重新加载</Button></div> : null}
      {loadState === 'ready' && nonDuplicateWorks.length === 0 ? <div className="works-state"><strong>还没有作品</strong><span>导入本地视频或单条抖音作品，完成后会在这里显示拆解结果。</span><Button onClick={() => openImport()}>导入第一个作品</Button></div> : null}
      {loadState === 'ready' && nonDuplicateWorks.length > 0 && works.length === 0 ? <div className="works-state"><strong>没有符合条件的作品</strong><span>可以更换筛选条件或搜索关键词。</span></div> : null}
      {loadState === 'ready' && works.length > 0 ? (
        <div className="table-wrap"><table className="data-table works-table"><thead><tr><th>作品</th><th>发布时间</th><th>点赞量</th><th>相对爆款</th><th>借鉴评分</th><th>判断与进度</th><th><span className="visually-hidden">操作</span></th></tr></thead><tbody>{works.map((work) => <WorkStatusRow focusOnRender={focusedWorkId === work.id} key={work.id} onFocusConsumed={(workId) => setFocusedWorkId((current) => current === workId ? undefined : current)} onLocalFallback={(item) => void chooseLocalFallback(item)} onRetry={retryImport} work={work} />)}</tbody></table></div>
      ) : null}
      {importOpen ? <ImportWorkDialog creatorLoadState={creatorLoadState} creators={creators} initialCreatorId={initialCreatorId} initialLocalPath={initialLocalPath} onAccepted={acceptImport} onClose={closeImport} onRetryCreators={() => void loadCreators()} /> : null}
    </div>
  )
}

function FilterButton({ children, current, id, onSelect }: { children: React.ReactNode; current: WorkFilter; id: WorkFilter; onSelect(filter: WorkFilter): void }): React.JSX.Element {
  return <button aria-pressed={current === id} onClick={() => onSelect(id)} type="button">{children}</button>
}

function WorksLoading(): React.JSX.Element {
  return <div aria-label="正在加载作品" className="works-loading" role="status"><span className="visually-hidden">正在加载作品</span>{[0, 1, 2].map((row) => <div aria-hidden="true" key={row}><i /><i /><i /></div>)}</div>
}
