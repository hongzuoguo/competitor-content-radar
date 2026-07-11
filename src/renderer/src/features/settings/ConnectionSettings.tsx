import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/Button'

export function ConnectionSettings({ douyinLoggedIn = false, feishuConnected = false, onLogin }: { douyinLoggedIn?: boolean; feishuConnected?: boolean; onLogin?: () => void }): React.JSX.Element {
  return (
    <section className="settings-section" aria-labelledby="connection-settings-title">
      <div className="settings-section__heading"><div><h2 id="connection-settings-title">账号与同步</h2><p>登录抖音用于采集公开作品，授权飞书用于同步分析结果。</p></div></div>
      <div className="connection-list">
        <div><span className="connection-icon">{douyinLoggedIn ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span><span><strong>抖音账号</strong><small>{douyinLoggedIn ? '当前登录有效' : '尚未确认登录状态'}</small></span><Button onClick={onLogin} type="button" variant="secondary">{douyinLoggedIn ? '重新登录' : '扫码登录'}</Button></div>
        <div><span className="connection-icon">{feishuConnected ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span><span><strong>飞书多维表格</strong><small>{feishuConnected ? '已连接“对标内容雷达”' : '尚未授权，可稍后配置'}</small></span><Button disabled={!feishuConnected} type="button" variant="secondary">{feishuConnected ? '查看表格' : '尚未连接'}</Button></div>
      </div>
    </section>
  )
}
