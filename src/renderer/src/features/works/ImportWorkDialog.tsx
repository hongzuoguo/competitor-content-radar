import { FileVideo, Link2, Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { CreatorView, ImportStartResult } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'

type SourceType = 'local' | 'douyin_url'
export type ImportAcceptedResult = ImportStartResult & { existingWorkId?: string }

interface ImportErrorLike {
  code?: string
  message?: string
  action?: string
}

export function ImportWorkDialog({
  creators,
  onAccepted,
  onClose
}: {
  creators: CreatorView[]
  onAccepted(result: ImportAcceptedResult): void
  onClose(): void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [sourceType, setSourceType] = useState<SourceType>('local')
  const [localPath, setLocalPath] = useState('')
  const [url, setUrl] = useState('')
  const [creatorId, setCreatorId] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [offerLocalFallback, setOfferLocalFallback] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [])

  function selectSource(next: SourceType): void {
    setSourceType(next)
    setFieldError('')
    setSubmitError('')
    setOfferLocalFallback(false)
  }

  async function pickLocalVideo(): Promise<void> {
    setFieldError('')
    setSubmitError('')
    try {
      const path = await window.desktopApi.pickLocalVideo()
      if (path) setLocalPath(path)
    } catch {
      setFieldError('无法打开文件选择器，请稍后重试。')
    }
  }

  async function switchToLocal(): Promise<void> {
    selectSource('local')
    await pickLocalVideo()
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
    setOfferLocalFallback(false)
    try {
      const result = await window.desktopApi.startImport({
        source: sourceType === 'local'
          ? { type: 'local', path: localPath }
          : { type: 'douyin_url', url: url.trim() },
        creatorId: creatorId || null
      })
      onAccepted(result as ImportAcceptedResult)
    } catch (error) {
      const details = error as ImportErrorLike
      const downloadUnavailable = details.code === 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' || details.action === 'upload_local'
      setSubmitError(downloadUnavailable
        ? '无法获取这个视频。请先保存视频到电脑，再从本地上传。'
        : stableErrorMessage(details))
      setOfferLocalFallback(downloadUnavailable)
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
        <button aria-pressed={sourceType === 'local'} onClick={() => selectSource('local')} type="button"><FileVideo size={16} aria-hidden="true" />本地视频</button>
        <button aria-pressed={sourceType === 'douyin_url'} onClick={() => selectSource('douyin_url')} type="button"><Link2 size={16} aria-hidden="true" />抖音链接</button>
      </div>

      <div className="import-dialog__body">
        {sourceType === 'local' ? (
          <div className="form-field">
            <span className="import-field-label">视频文件</span>
            <div className="file-picker">
              <FileVideo size={24} aria-hidden="true" />
              {fileName ? <div><strong>{fileName}</strong><small title={localPath}>{localPath}</small></div> : <div><strong>选择一个视频文件</strong><small>支持 MP4、MOV、MKV 和 WebM</small></div>}
              <Button icon={<Upload size={16} />} onClick={() => void pickLocalVideo()} variant="secondary">{fileName ? '重新选择' : '选择视频'}</Button>
            </div>
            {fieldError ? <span className="form-error" role="alert">{fieldError}</span> : null}
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
          <select id="import-creator" onChange={(event) => setCreatorId(event.target.value)} value={creatorId}>
            <option value="">未分类作品</option>
            {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
          </select>
          <span className="form-help">不选择博主也可以继续分析。</span>
        </div>

        {submitError ? (
          <div className="import-error" role="alert">
            <strong>导入未开始</strong><span>{submitError}</span>
            {offerLocalFallback ? <Button onClick={() => void switchToLocal()} variant="secondary">改为上传本地视频</Button> : null}
          </div>
        ) : null}
      </div>

      <div className="import-dialog__actions">
        <Button disabled={submitting} onClick={onClose} variant="secondary">取消</Button>
        <Button disabled={submitting} onClick={() => void submit()}>{submitting ? '正在启动…' : '开始分析'}</Button>
      </div>
    </dialog>
  )
}

function validateSource(sourceType: SourceType, localPath: string, rawUrl: string): string {
  if (sourceType === 'local') return localPath ? '' : '请先选择一个视频文件。'
  const value = rawUrl.trim()
  if (!value) return '请粘贴抖音单条视频链接。'
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !isDouyinHost(parsed.hostname)) throw new Error('invalid')
    const singleVideo = /^\/video\/\d+\/?$/.test(parsed.pathname)
      || parsed.hostname === 'v.douyin.com'
      || /^\d+$/.test(parsed.searchParams.get('vid') ?? '')
    return singleVideo ? '' : '请输入抖音单条视频链接，不支持博主主页。'
  } catch {
    return '请输入有效的抖音单条视频链接。'
  }
}

function isDouyinHost(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
}

function stableErrorMessage(error: ImportErrorLike): string {
  const messages: Record<string, string> = {
    UNSUPPORTED_VIDEO_FORMAT: '暂不支持这个视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。',
    LOCAL_FILE_UNREADABLE: '无法读取这个视频，请确认文件仍在原位置且未被其他程序占用。',
    INSUFFICIENT_DISK_SPACE: '磁盘空间不足，请清理空间后重试。',
    CREATOR_NOT_FOUND: '关联的博主已不存在，请重新选择。'
  }
  return (error.code && messages[error.code]) || error.message || '导入失败，请稍后重试。'
}
