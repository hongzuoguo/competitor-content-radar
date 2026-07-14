import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CreatorView, ImportStartResult, WorkFocusRequest, WorkListItem } from '../../../shared/ipc-contract'
import { Button } from '../components/Button'
import { ImportWorkDialog, type CreatorLoadState } from '../features/works/ImportWorkDialog'
import { CreatorRail } from '../features/works/CreatorRail'
import { SubscriptionWorkList } from '../features/works/SubscriptionWorkList'
import { WorkInspector } from '../features/works/WorkInspector'
import './workspace-pages.css'

type LoadState = 'loading' | 'ready' | 'failed'

export function WorksPage({ onImportAccepted, focusRequest }: {
  onImportAccepted?(result: ImportStartResult): void
  focusRequest?: WorkFocusRequest
} = {}): React.JSX.Element {
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
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [detailRevision, setDetailRevision] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<WorkListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const worksAreaRef = useRef<HTMLDivElement>(null)
  const deleteRunningRef = useRef(false)
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
          setDetailRevision((current) => current + 1)
          setLoadState('ready')
          setRefreshWarning('')
          hasSuccessfulLoadRef.current = true
          const duplicate = pendingImportIdRef.current && nextDuplicateCandidateId === pendingImportIdRef.current
            ? nextWorks.find((work) => work.id === nextDuplicateCandidateId && work.errorCode === 'IMPORT_DUPLICATE' && work.existingWorkId)
            : undefined
          if (duplicate?.existingWorkId && nextWorks.some((work) => work.id === duplicate.existingWorkId)) {
            pendingImportIdRef.current = undefined
            cancelFocusRestore()
            const existing = nextWorks.find((work) => work.id === duplicate.existingWorkId)
            if (existing?.creatorId) setSelectedCreatorId(existing.creatorId)
            setSelectedWorkId(duplicate.existingWorkId)
            setFocusedWorkId(duplicate.existingWorkId)
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
    void loadCreators()
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
    if (selectedCreatorId && creators.some((creator) => creator.id === selectedCreatorId && creator.enabled)) return
    setSelectedCreatorId(creators.find((creator) => creator.enabled)?.id ?? null)
  }, [creators, selectedCreatorId])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!pendingDelete || !dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [pendingDelete])

  useEffect(() => {
    if (!focusRequest || handledFocusRequestRef.current === focusRequest.requestId) return
    if (!allWorks.some((work) => work.id === focusRequest.workId && work.errorCode !== 'IMPORT_DUPLICATE')) return
    handledFocusRequestRef.current = focusRequest.requestId
    const focused = allWorks.find((work) => work.id === focusRequest.workId)
    if (focused?.creatorId) setSelectedCreatorId(focused.creatorId)
    setSelectedWorkId(focusRequest.workId)
    setFocusedWorkId(focusRequest.workId)
  }, [allWorks, focusRequest])

  const nonDuplicateWorks = useMemo(() => allWorks.filter((work) => work.errorCode !== 'IMPORT_DUPLICATE'), [allWorks])
  const effectiveSelectedCreatorId = creators.some((creator) => creator.id === selectedCreatorId && creator.enabled)
    ? selectedCreatorId
    : creators.find((creator) => creator.enabled)?.id ?? null
  const creatorWorks = useMemo(() => {
    if (creatorLoadState === 'loading') return []
    const scoped = effectiveSelectedCreatorId ? nonDuplicateWorks.filter((work) => work.creatorId === effectiveSelectedCreatorId) : nonDuplicateWorks
    return [...scoped].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  }, [creatorLoadState, effectiveSelectedCreatorId, nonDuplicateWorks])

  useEffect(() => {
    if (selectedWorkId && creatorWorks.some((work) => work.id === selectedWorkId)) return
    setSelectedWorkId(creatorWorks[0]?.id ?? null)
  }, [creatorWorks, selectedWorkId])

  function openImport(options: { creatorId?: string | null; localPath?: string } = {}): void {
    cancelFocusRestore()
    setInitialCreatorId(options.creatorId)
    setInitialLocalPath(options.localPath)
    setImportOpen(true)
    setMessage('')
  }

  async function loadCreators(): Promise<void> {
    if (creators.length === 0) setCreatorLoadState('loading')
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

  function requestDelete(work: WorkListItem, trigger: HTMLButtonElement): void {
    deleteTriggerRef.current = trigger
    setDeleteError('')
    setPendingDelete(work)
  }

  function cancelDelete(): void {
    if (deleteRunningRef.current) return
    setPendingDelete(null)
    setDeleteError('')
    cancelFocusRestore()
    focusRestoreFrameRef.current = requestAnimationFrame(() => {
      focusRestoreFrameRef.current = null
      deleteTriggerRef.current?.focus()
    })
  }

  async function deleteFailedWork(): Promise<void> {
    if (!pendingDelete || deleteRunningRef.current) return
    const work = pendingDelete
    deleteRunningRef.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await window.desktopApi.deleteFailedWork(work.id)
      if (!mountedRef.current) return
      setAllWorks((current) => current.filter((item) => item.id !== work.id))
      setSelectedWorkId((current) => current === work.id ? null : current)
      setPendingDelete(null)
      setMessage('失败任务已删除。')
      cancelFocusRestore()
      focusRestoreFrameRef.current = requestAnimationFrame(() => {
        focusRestoreFrameRef.current = null
        worksAreaRef.current?.focus()
      })
      void refreshWorks()
    } catch {
      if (mountedRef.current) setDeleteError('删除失败，请稍后重试。')
    } finally {
      deleteRunningRef.current = false
      if (mountedRef.current) setDeleting(false)
    }
  }

  return (
    <div className="page workspace-page">
      <header className="page-heading"><div><h1>订阅工作台</h1><p>每天查看博主新作、表现信号和可复用的内容方法。</p></div><div className="page-heading__actions"><Button icon={<Plus size={16} />} onClick={() => openImport()} ref={importButtonRef}>导入作品</Button></div></header>
      {message ? <p aria-live="polite" className="page-message">{message}</p> : null}
      {refreshWarning ? <p aria-live="polite" className="page-message">{refreshWarning}</p> : null}
      <div aria-label="作品表格区域" className="works-focus-region" ref={worksAreaRef} role="region" tabIndex={-1}>
        {loadState === 'loading' ? <WorksLoading /> : null}
        {loadState === 'failed' ? <div className="works-state" role="alert"><strong>作品加载失败</strong><span>无法读取本地作品记录，请稍后重试。</span><Button onClick={() => void refreshWorks(true)} variant="secondary">重新加载</Button></div> : null}
        {loadState === 'ready' && nonDuplicateWorks.length === 0 ? <div className="works-state"><strong>还没有作品</strong><span>导入本地视频或单条抖音作品，完成后会在这里显示拆解结果。</span><Button onClick={() => openImport()}>导入第一个作品</Button></div> : null}
        {loadState === 'ready' && nonDuplicateWorks.length > 0 ? <div className="subscription-workspace">
          <CreatorRail creators={creators} onSelect={(id) => { setSelectedCreatorId(id); setSelectedWorkId(null) }} selectedId={effectiveSelectedCreatorId} />
          <SubscriptionWorkList focusId={focusedWorkId} onDeleteRequest={requestDelete} onFocusConsumed={(workId) => setFocusedWorkId((current) => current === workId ? undefined : current)} onLocalFallback={(item) => void chooseLocalFallback(item)} onRetry={retryImport} onSelect={setSelectedWorkId} selectedId={selectedWorkId} works={creatorWorks} />
          <WorkInspector revision={detailRevision} workId={selectedWorkId} />
        </div> : null}
      </div>
      {importOpen ? <ImportWorkDialog creatorLoadState={creatorLoadState} creators={creators} initialCreatorId={initialCreatorId} initialLocalPath={initialLocalPath} onAccepted={acceptImport} onClose={closeImport} onRetryCreators={() => void loadCreators()} /> : null}
      {pendingDelete ? (
        <dialog aria-labelledby="delete-work-title" className="confirm-dialog" onCancel={(event) => { event.preventDefault(); cancelDelete() }} ref={deleteDialogRef}>
          <h2 id="delete-work-title">删除失败任务？</h2>
          <p>将删除这条本地任务记录和临时文件，不会影响抖音原作品。此操作无法撤销。</p>
          {deleteError ? <p className="confirm-dialog__error" role="alert">{deleteError}</p> : null}
          <div className="confirm-dialog__actions">
            <Button autoFocus disabled={deleting} onClick={cancelDelete} variant="secondary">取消</Button>
            <Button disabled={deleting} onClick={() => void deleteFailedWork()} variant="danger">{deleting ? '正在删除…' : '确认删除'}</Button>
          </div>
        </dialog>
      ) : null}
    </div>
  )
}

function WorksLoading(): React.JSX.Element {
  return <div aria-label="正在加载作品" className="works-loading" role="status"><span className="visually-hidden">正在加载作品</span>{[0, 1, 2].map((row) => <div aria-hidden="true" key={row}><i /><i /><i /></div>)}</div>
}
