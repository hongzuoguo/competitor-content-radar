import { FileVideo, Link2, Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { CreatorView, ImportStartResult } from '../../../../shared/ipc-contract'
import { parseDouyinWorkUrl } from '../../../../shared/douyin-work-url'
import { Button } from '../../components/Button'

type SourceType = 'local' | 'douyin_url'
export type CreatorLoadState = 'loading' | 'ready' | 'failed'
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'webm'])

interface ImportErrorLike {
  code?: string
}

export function ImportWorkDialog({
  creators,
  creatorLoadState,
  initialCreatorId,
  initialLocalPath,
  onAccepted,
  onClose,
  onRetryCreators
}: {
  creators: CreatorView[]
  creatorLoadState: CreatorLoadState
  initialCreatorId?: string | null
  initialLocalPath?: string
  onAccepted(result: ImportStartResult): void
  onClose(): void
  onRetryCreators(): void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const localTabRef = useRef<HTMLButtonElement>(null)
  const urlTabRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const localLabelId = useId()
  const localHelpId = useId()
  const localErrorId = useId()
  const creatorHelpId = useId()
  const [sourceType, setSourceType] = useState<SourceType>('local')
  const [localPath, setLocalPath] = useState(initialLocalPath ?? '')
  const [url, setUrl] = useState('')
  const [creatorId, setCreatorId] = useState(initialCreatorId ?? '')
  const [fieldError, setFieldError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmedUnclassified, setConfirmedUnclassified] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [])

  useEffect(() => {
    setConfirmedUnclassified(false)
  }, [creatorLoadState])

  function selectSource(next: SourceType): void {
    setSourceType(next)
    setFieldError('')
    setSubmitError('')
  }

  async function pickLocalVideo(): Promise<void> {
    setFieldError('')
    setSubmitError('')
    try {
      const path = await window.desktopApi.pickLocalVideo()
      if (path) setLocalVideoPath(path)
    } catch {
      setFieldError('无法打开文件选择器，请稍后重试。')
    }
  }

  function handleDroppedFile(file: File | undefined): void {
    setSubmitError('')
    if (!file) return
    try {
      const path = window.desktopApi.getPathForFile(file)
      if (path) setLocalVideoPath(path)
      else throw new Error('empty file path')
    } catch {
      setLocalPath('')
      setFieldError('无法读取拖放的视频，请改用“选择视频”。')
    }
  }

  function setLocalVideoPath(path: string): void {
    if (isSupportedVideoPath(path)) {
      setFieldError('')
      setLocalPath(path)
    } else {
      setLocalPath('')
      setFieldError('暂不支持这个视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。')
    }
  }

  async function submit(): Promise<void> {
    if (submitting) return
    const validation = validateSource(sourceType, localPath, url)
    if (validation) {
      setFieldError(validation)
      return
    }

    setSubmitting(true)
    setFieldError('')
    setSubmitError('')
    try {
      const result = await window.desktopApi.startImport({
        source: sourceType === 'local'
          ? { type: 'local', path: localPath }
          : { type: 'douyin_url', url: url.trim() },
        creatorId: creatorId || null
      })
      onAccepted(result)
    } catch (error) {
      const details = error as ImportErrorLike
      setSubmitError(stableErrorMessage(details))
    } finally {
      setSubmitting(false)
    }
  }

  const fileName = localPath.split(/[\\/]/).pop()
  return (
    <dialog
      aria-labelledby={titleId}
      className="import-dialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!submitting) onClose()
      }}
      ref={dialogRef}
    >
      <div className="import-dialog__heading">
        <div><h2 id={titleId}>导入作品</h2><p>导入后将在后台自动生成文字稿并完成内容拆解。</p></div>
        <Button aria-label="关闭导入作品" disabled={submitting} icon={<X size={18} />} onClick={onClose} variant="ghost" />
      </div>

      <div aria-label="内容来源" className="import-source-tabs" role="group">
        <button aria-pressed={sourceType === 'local'} onClick={() => selectSource('local')} onKeyDown={(event) => switchTabWithArrow(event, 'douyin_url', urlTabRef, selectSource)} ref={localTabRef} type="button"><FileVideo size={16} aria-hidden="true" />本地视频</button>
        <button aria-pressed={sourceType === 'douyin_url'} onClick={() => selectSource('douyin_url')} onKeyDown={(event) => switchTabWithArrow(event, 'local', localTabRef, selectSource)} ref={urlTabRef} type="button"><Link2 size={16} aria-hidden="true" />抖音链接</button>
      </div>

      <div className="import-dialog__body">
        {sourceType === 'local' ? (
          <div className="form-field">
            <span className="import-field-label" id={localLabelId}>视频文件</span>
            <div
              aria-labelledby={localLabelId}
              className="file-picker"
              data-testid="local-video-drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); handleDroppedFile(event.dataTransfer.files[0]) }}
            >
              <FileVideo size={24} aria-hidden="true" />
              {fileName ? <div><strong>{fileName}</strong><small id={localHelpId} title={localPath}>{localPath}</small></div> : <div><strong>选择或拖入一个视频文件</strong><small id={localHelpId}>支持 MP4、MOV、MKV 和 WebM</small></div>}
              <Button aria-describedby={fieldError ? localErrorId : localHelpId} icon={<Upload size={16} />} onClick={() => void pickLocalVideo()} variant="secondary">{fileName ? '重新选择' : '选择视频'}</Button>
            </div>
            {fieldError ? <span className="form-error" id={localErrorId} role="alert">{fieldError}</span> : null}
          </div>
        ) : (
          <div className="form-field">
            <label htmlFor="import-douyin-url">抖音单条视频链接</label>
            <input
              aria-describedby={fieldError ? 'import-url-error' : 'import-url-help'}
              autoFocus
              id="import-douyin-url"
              onChange={(event) => { setUrl(event.target.value); setFieldError('') }}
              placeholder="https://www.douyin.com/video/..."
              type="url"
              value={url}
            />
            {fieldError ? <span className="form-error" id="import-url-error" role="alert">{fieldError}</span> : <span className="form-help" id="import-url-help">仅支持单条公开作品链接，不支持博主主页。</span>}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="import-creator">关联博主（可选）</label>
          <select aria-describedby={creatorHelpId} disabled={creatorLoadState !== 'ready'} id="import-creator" onChange={(event) => setCreatorId(event.target.value)} value={creatorId}>
            <option value="">未分类作品</option>
            {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
          </select>
          {creatorLoadState === 'loading' ? <span className="form-help" id={creatorHelpId} role="status">正在加载博主列表…</span> : null}
          {creatorLoadState === 'ready' ? <span className="form-help" id={creatorHelpId}>不选择博主也可以继续分析。</span> : null}
          {creatorLoadState === 'failed' ? (
            <div className="creator-load-error" id={creatorHelpId} role="alert">
              <span>博主列表加载失败。你可以重试，或确认以未分类作品继续。</span>
              <Button onClick={onRetryCreators} variant="secondary">重试加载博主</Button>
              <label><input checked={confirmedUnclassified} onChange={(event) => setConfirmedUnclassified(event.target.checked)} type="checkbox" />确认以未分类作品继续</label>
            </div>
          ) : null}
        </div>

        {submitError ? (
          <div className="import-error" role="alert">
            <strong>导入未开始</strong><span>{submitError}</span>
          </div>
        ) : null}
      </div>

      <div className="import-dialog__actions">
        <Button disabled={submitting} onClick={onClose} variant="secondary">取消</Button>
        <Button disabled={submitting || creatorLoadState === 'loading' || (creatorLoadState === 'failed' && !confirmedUnclassified)} onClick={() => void submit()}>{submitting ? '正在启动…' : '开始分析'}</Button>
      </div>
    </dialog>
  )
}

function validateSource(sourceType: SourceType, localPath: string, rawUrl: string): string {
  if (sourceType === 'local') return localPath ? '' : '请先选择一个视频文件。'
  const value = rawUrl.trim()
  if (!value) return '请粘贴抖音单条视频链接。'
  try {
    new URL(value)
    if (parseDouyinWorkUrl(value)) return ''
    return '请输入抖音单条视频链接，不支持博主主页。'
  } catch {
    return '请输入有效的抖音链接。'
  }
}

function isSupportedVideoPath(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension !== undefined && SUPPORTED_VIDEO_EXTENSIONS.has(extension)
}

function stableErrorMessage(error: ImportErrorLike): string {
  const messages: Record<string, string> = {
    UNSUPPORTED_VIDEO_FORMAT: '暂不支持这个视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。',
    FILE_NOT_FOUND: '无法读取这个视频，请确认文件仍在原位置。',
    INSUFFICIENT_DISK_SPACE: '磁盘空间不足，请清理空间后重试。',
    MEDIA_COPY_FAILED: '视频复制失败，请检查磁盘空间后重试。',
    INVALID_CREATOR: '关联的博主已不存在，请重新选择。',
    INVALID_IMPORT_INPUT: '导入信息不完整，请重新选择视频或检查链接。',
    INVALID_IMPORT_REQUEST: '导入信息格式无效，请重新选择视频或检查链接。',
    APP_SHUTTING_DOWN: '应用正在关闭，请重新打开应用后再导入。',
    RUN_ALREADY_ACTIVE: '已有导入任务正在启动，请稍后再试。',
    JOB_NOT_RETRYABLE: '这个任务当前无法重试。'
  }
  return (error.code && messages[error.code]) || '导入失败，请稍后重试。'
}

function switchTabWithArrow(
  event: React.KeyboardEvent<HTMLButtonElement>,
  next: SourceType,
  nextRef: React.RefObject<HTMLButtonElement | null>,
  selectSource: (source: SourceType) => void
): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  selectSource(next)
  requestAnimationFrame(() => nextRef.current?.focus())
}
