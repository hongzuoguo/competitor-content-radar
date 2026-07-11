import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Button } from '../../components/Button'

export function ConnectionSettings(): React.JSX.Element {
  return (
    <section className="settings-section" aria-labelledby="connection-settings-title">
      <div className="settings-section__heading"><div><h2 id="connection-settings-title">账号与同步</h2><p>登录抖音用于采集公开作品，授权飞书用于同步分析结果。</p></div></div>
      <div className="connection-list">
        <div><span className="connection-icon"><CheckCircle2 size={18} /></span><span><strong>抖音账号</strong><small>当前登录有效</small></span><Button variant="secondary">重新登录</Button></div>
        <div><span className="connection-icon"><CheckCircle2 size={18} /></span><span><strong>飞书多维表格</strong><small>已连接“对标内容雷达”</small></span><Button icon={<ExternalLink size={15} />} variant="secondary">查看表格</Button></div>
      </div>
    </section>
  )
}
