import { AlertCircle, CheckCircle2, Cloud, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { feishuUserErrorFromUnknown, type FeishuConnectionView, type FeishuCustomAppConnectionInput, type FeishuSyncMode, type FeishuUserError } from '../../../../shared/ipc-contract'
import { isFeishuTemplateUrl } from '../../../../shared/feishu-template'
import { Button } from '../../components/Button'
import { FeishuErrorMessage } from './FeishuErrorMessage'
import { validateFeishuRetentionDays } from './settings-validation'

interface ConnectionSettingsProps {
  douyinLoggedIn?: boolean
  feishu: FeishuConnectionView
  feishuActionError?: FeishuUserError | null
  loginMessage?: string
  busyAction?: string
  onLogin?(): void
  onLogout?(): void
  onCheckLogin?(): void
  onConnect(input: FeishuCustomAppConnectionInput): Promise<void>
  onRepair(appToken?: string): void
  onRecreate(): void
  onSync(): void
  onOpen(): void
  onOpenTemplate(): Promise<void>
  onOpenDeveloperConsole(): void
  onDisconnect(): void
  feishuSyncMode?: FeishuSyncMode
  feishuSyncRecentDays?: number
  feishuRetentionDays?: number
  showFeishuTimingErrors?: boolean
}

export function ConnectionSettings({
  douyinLoggedIn = false,
  feishu,
  feishuActionError = null,
  loginMessage = '',
  busyAction = '',
  onLogout,
  onLogin,
  onCheckLogin,
  onConnect,
  onRepair,
  onRecreate,
  onSync,
  onOpen,
  onOpenTemplate,
  onOpenDeveloperConsole,
  onDisconnect,
  feishuSyncMode = 'auto',
  feishuSyncRecentDays = 30,
  feishuRetentionDays = 30,
  showFeishuTimingErrors = false
}: ConnectionSettingsProps): React.JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [setupError, setSetupError] = useState<string | FeishuUserError | null>(null)
  const [syncMode, setSyncMode] = useState<FeishuSyncMode>(feishuSyncMode)
  const [syncRecentDays, setSyncRecentDays] = useState(String(feishuSyncRecentDays))
  const [syncRecentDaysTouched, setSyncRecentDaysTouched] = useState(false)
  const [retentionDays, setRetentionDays] = useState(String(feishuRetentionDays))
  const [retentionDaysTouched, setRetentionDaysTouched] = useState(false)
  const isConnected = feishu.status === 'connected' || feishu.status === 'sync_error'
  const isWaiting = feishu.status === 'provisioning' || feishu.status === 'syncing_data' || Boolean(busyAction)
  const baseWasDeleted = feishu.status === 'needs_repair' && feishu.message.includes('不存在')
  const syncRecentDaysError = validateFeishuRetentionDays(syncRecentDays)
  const retentionDaysError = validateFeishuRetentionDays(retentionDays)
  const showSyncRecentDaysError = Boolean(syncRecentDaysError && (syncRecentDaysTouched || showFeishuTimingErrors))
  const showRetentionDaysError = Boolean(retentionDaysError && (retentionDaysTouched || showFeishuTimingErrors))

  async function connect(): Promise<void> {
    const input = {
      appId: appId.trim(),
      appSecret: appSecret.trim(),
      baseUrl: baseUrl.trim()
    }
    if (isFeishuTemplateUrl(input.baseUrl)) {
      setSetupError('这是公共模板链接。请先点击“使用完整模板”创建自己的副本，再粘贴副本链接。')
      return
    }
    if (!input.appId || !input.appSecret || !input.baseUrl) {
      setSetupError('请填写 App ID、App Secret 和多维表格链接')
      return
    }
    setSetupError(null)
    try {
      await onConnect(input)
      setAppSecret('')
      closeSetup()
    } catch (error) {
      setSetupError(feishuUserErrorFromUnknown(error) ?? '连接失败，请检查应用权限和表格链接后重试。')
    }
  }

  async function openTemplate(): Promise<void> {
    setSetupError(null)
    try {
      await onOpenTemplate()
    } catch {
      setSetupError('无法打开飞书模板，请稍后重试。')
    }
  }

  function toggleSetup(): void {
    if (setupOpen) setSetupError(null)
    setSetupOpen(!setupOpen)
  }

  function closeSetup(): void {
    setSetupError(null)
    setSetupOpen(false)
  }

  return (
    <section className="settings-section" aria-labelledby="connection-settings-title">
      <div className="settings-section__heading">
        <div>
          <h3 id="connection-settings-title">抖音与飞书</h3>
          <p>抖音用于采集公开作品；飞书使用你自己的应用，把本地分析结果直接同步到你的多维表格。</p>
        </div>
      </div>
      <div className="connection-list">
        <div className="connection-row">
          <span className="connection-icon" data-tone={douyinLoggedIn ? 'success' : 'warning'}>{douyinLoggedIn ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span>
          <span className="connection-row__body"><strong>抖音账号</strong></span>
          <small className="connection-row__status" data-tone={douyinLoggedIn ? 'success' : 'warning'}>{douyinLoggedIn ? '应用专属浏览器已登录' : '请先在应用专属浏览器中登录'}</small>
          <span className="connection-action">
            {douyinLoggedIn ? (
              <>
                <Button onClick={onCheckLogin} type="button" variant="ghost">刷新登录状态</Button>
                <Button onClick={onLogout} type="button" variant="secondary">登出</Button>
              </>
            ) : (
              <>
                <Button onClick={onLogin} type="button" variant="secondary">打开浏览器登录</Button>
                <Button onClick={onCheckLogin} type="button" variant="ghost">刷新登录状态</Button>
              </>
            )}
          </span>
          {loginMessage ? <small aria-live="polite" className="form-help">{loginMessage}</small> : null}
        </div>
        <div className="connection-row connection-row--feishu">
          <span className="connection-icon" data-tone={connectionTone(feishu.status)}>
            {isWaiting ? <LoaderCircle aria-hidden="true" className="connection-spinner" size={18} /> : isConnected ? <CheckCircle2 size={18} /> : feishu.status === 'disconnected' ? <Cloud size={18} /> : <AlertCircle size={18} />}
          </span>
          <span className="connection-row__body">
            <strong>飞书多维表格</strong>
            {feishu.maskedAppId ? <small>{feishu.maskedAppId}</small> : null}
            {feishu.lastSyncedAt ? <small>最近同步：{formatSyncTime(feishu.lastSyncedAt)}</small> : null}
          </span>
          <small className="connection-row__status" data-tone={connectionTone(feishu.status)}>{connectionStatusCopy(feishu)}</small>
          <div className="connection-buttons">
            {!isConnected && feishu.status !== 'needs_repair' ? <Button disabled={isWaiting} onClick={toggleSetup} type="button">配置飞书同步</Button> : null}
            {feishu.status === 'provisioning' ? <Button disabled type="button">正在验证连接…</Button> : null}
            {feishu.status === 'syncing_data' ? <Button disabled type="button">正在同步数据…</Button> : null}
            {isConnected ? <>
              <Button disabled={isWaiting} onClick={onSync} type="button">立即同步</Button>
              <Button disabled={isWaiting || !feishu.baseUrl} onClick={onOpen} type="button" variant="secondary">打开表格</Button>
              <div aria-label="更多飞书操作" className="connection-buttons__more" role="group">
                <Button disabled={isWaiting} onClick={toggleSetup} type="button" variant="ghost">重新配置</Button>
                <Button className="connection-buttons__disconnect" disabled={isWaiting} onClick={onDisconnect} type="button" variant="ghost">断开连接</Button>
              </div>
            </> : null}
            {feishu.status === 'needs_repair' && !feishu.candidates?.length ? (
              baseWasDeleted
                ? <Button disabled={isWaiting} onClick={onRecreate} type="button">重新创建表格</Button>
                : <Button disabled={isWaiting} onClick={() => onRepair()} type="button">修复表结构</Button>
            ) : null}
          </div>
          {((!setupError && (feishuActionError || feishu.message)) || feishu.hasPendingChanges) ? (
            <div className="connection-row__messages">
              {!setupError && feishuActionError ? <FeishuErrorMessage error={feishuActionError} id="feishu-action-error" /> : null}
              {!setupError && !feishuActionError && feishu.message ? <p aria-live="polite" className="connection-message" role={feishu.status === 'connected' ? undefined : 'alert'}>{feishu.message}</p> : null}
              {feishu.hasPendingChanges ? <small className="form-help">{feishuSyncMode === 'manual'
                ? '本地更新待同步，请点击“立即同步”。'
                : '本地更新将在当前任务结束时同步到飞书。'}</small> : null}
            </div>
          ) : null}
          {setupOpen ? (
            <fieldset className="feishu-custom-app" onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                event.preventDefault()
                void connect()
              }
            }}>
              <legend>使用你自己的飞书应用</legend>
              <p>配置一次后，历史数据和新作品都会自动同步，不经过第三方中转服务。</p>
              <ol>
                <li>点击“使用完整模板”，在飞书中创建属于你的完整 Base。</li>
                <li>在飞书开放平台创建企业自建应用。</li>
                <li>开通多维表格读写权限；使用 /wiki/ 链接时还需开通“查看知识空间节点信息”，然后发布应用版本。</li>
                <li>在刚复制的 Base 中添加该应用为文档应用，并授予可管理权限。</li>
              </ol>
              <div className="feishu-custom-app__links">
                <Button icon={<ExternalLink size={16} />} onClick={() => void openTemplate()} type="button" variant="secondary">使用完整模板</Button>
                <Button icon={<ExternalLink size={16} />} onClick={onOpenDeveloperConsole} type="button" variant="secondary">打开飞书开放平台</Button>
              </div>
              <div className="feishu-custom-app__fields">
                <div className="form-field"><label htmlFor="feishu-app-id">App ID</label><input aria-describedby={setupError ? 'feishu-connect-error' : undefined} autoComplete="off" id="feishu-app-id" onChange={(event) => setAppId(event.target.value)} placeholder="cli_..." value={appId} /></div>
                <div className="form-field"><label htmlFor="feishu-app-secret">App Secret</label><input aria-describedby={setupError ? 'feishu-connect-error' : undefined} autoComplete="new-password" id="feishu-app-secret" onChange={(event) => setAppSecret(event.target.value)} type="password" value={appSecret} /></div>
                <div className="form-field feishu-custom-app__base-url"><label htmlFor="feishu-base-url">多维表格链接</label><input aria-describedby={setupError ? 'feishu-connect-error' : undefined} id="feishu-base-url" onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.feishu.cn/base/..." type="url" value={baseUrl} /></div>
              </div>
              {typeof setupError === 'string' ? <p className="form-error" id="feishu-connect-error" role="alert">{setupError}</p> : null}
              {setupError && typeof setupError === 'object' ? <FeishuErrorMessage error={setupError} id="feishu-connect-error" /> : null}
              <div className="feishu-custom-app__actions">
                <Button disabled={isWaiting} onClick={() => void connect()} type="button">测试并连接</Button>
                <Button disabled={isWaiting} onClick={closeSetup} type="button" variant="ghost">取消</Button>
              </div>
            </fieldset>
          ) : null}
          {feishu.status === 'needs_repair' && feishu.candidates?.length ? (
            <div className="feishu-candidates">
              <p>请选择要继续维护的“对标内容雷达”，不会新建第二份表格。</p>
              {feishu.candidates.map((candidate, index) => (
                <div key={candidate.appToken}>
                  <span>候选表格 {index + 1}</span>
                  <small title={candidate.url}>{candidate.url}</small>
                  <Button aria-label={`使用候选表格 ${index + 1}`} disabled={isWaiting} onClick={() => onRepair(candidate.appToken)} type="button" variant="secondary">使用此表格</Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="settings-grid feishu-sync-settings">
          <div className="form-field">
            <label htmlFor="feishu-sync-mode">同步方式</label>
            <select aria-describedby="feishu-sync-mode-help" id="feishu-sync-mode" name="feishuSyncMode" onChange={(event) => setSyncMode(event.target.value as FeishuSyncMode)} value={syncMode}>
              <option value="auto">自动同步（推荐）</option>
              <option value="manual">手动同步</option>
            </select>
            <small className="form-help" id="feishu-sync-mode-help">{syncMode === 'auto'
              ? '任务结束后，自动同步本地变更。'
              : '本地保留变更，点击“立即同步”后上传。'}</small>
          </div>
          <div className="form-field">
            <label htmlFor="feishu-sync-recent-days">同步作品发布时间范围<span aria-hidden="true" className="form-label__context">最近</span></label>
            <span className="number-field"><input aria-describedby={`feishu-sync-recent-days-help${showSyncRecentDaysError ? ' feishu-sync-recent-days-error' : ''}`} aria-invalid={Boolean(syncRecentDaysError)} aria-label="同步作品发布时间范围" id="feishu-sync-recent-days" max="365" min="1" name="feishuSyncRecentDays" onChange={(event) => { setSyncRecentDays(event.target.value); setSyncRecentDaysTouched(true) }} required step="1" type="number" value={syncRecentDays} /> 天</span>
            <small id="feishu-sync-recent-days-help">仅同步最近 N 天发布的新作品。</small>
            {showSyncRecentDaysError ? <span className="form-error" id="feishu-sync-recent-days-error" role="alert">{syncRecentDaysError}</span> : null}
          </div>
          <div className="form-field">
            <label htmlFor="feishu-retention-days">飞书作品保留时间</label>
            <span className="number-field"><input aria-describedby={`feishu-retention-days-help${showRetentionDaysError ? ' feishu-retention-days-error' : ''}`} aria-invalid={Boolean(retentionDaysError)} id="feishu-retention-days" max="365" min="1" name="feishuRetentionDays" onChange={(event) => { setRetentionDays(event.target.value); setRetentionDaysTouched(true) }} required step="1" type="number" value={retentionDays} /> 天</span>
            <small id="feishu-retention-days-help">从首次同步起算，满期后移入「归档作品」。</small>
            {showRetentionDaysError ? <span className="form-error" id="feishu-retention-days-error" role="alert">{retentionDaysError}</span> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function connectionStatusCopy(connection: FeishuConnectionView): string {
  if (connection.status === 'connected') return `已连接“${connection.baseName || '对标内容雷达'}”`
  if (connection.status === 'provisioning') return '正在验证应用权限和多维表格'
  if (connection.status === 'syncing_data') return '连接已就绪，正在同步本地数据到飞书'
  if (connection.status === 'needs_repair') return '需要你确认表格或修复核心字段'
  if (connection.status === 'sync_error') return `已连接“${connection.baseName || '对标内容雷达'}”，最近一次同步失败`
  return '尚未配置，完成一次设置后自动同步'
}

function connectionTone(status: FeishuConnectionView['status']): 'neutral' | 'success' | 'warning' {
  if (status === 'connected') return 'success'
  if (status === 'disconnected' || status === 'provisioning' || status === 'syncing_data') return 'neutral'
  return 'warning'
}

function formatSyncTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
