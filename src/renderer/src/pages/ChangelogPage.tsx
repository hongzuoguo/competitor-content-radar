import { ExternalLink, PenLine, Table2, TerminalSquare } from 'lucide-react'
import { Button } from '../components/Button'
import './changelog.css'

export const FEISHU_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Ey9lwoT00i1hdAk5ipbc2awUnVd'

const RELEASE_FEATURES = [
  {
    title: '文案改写',
    description: '基于作品的 AI 拆解结构与个人创作背景，生成观点和表达均为全新的内容。',
    icon: PenLine
  },
  {
    title: '本地 Agent CLI 接入',
    description: '可以使用本地 Agent 完成自动拆解，暂时支持 Codex，并复用你自己的登录、模型与推理强度设置。',
    icon: TerminalSquare
  },
  {
    title: '飞书多维表格接入',
    description: '把作品、拆解结果和持续追踪指标同步到你自己的飞书 Base，方便团队整理和复用。',
    icon: Table2
  }
] as const

const FEISHU_DATA = [
  ['博主与作品', '监控账号、我的作品、对标作品和归档作品'],
  ['内容拆解', '选题分类、内容关键词、钩子、结构、爆点、亮点和创作建议'],
  ['表现追踪', '互动总量、相对表现、每日指标快照和近 7 天增速'],
  ['创作洞察', '爆款筛选、素材视图、内容看板和创作方向']
] as const

export function ChangelogPage(): React.JSX.Element {
  return <div className="page changelog-page">
    <header className="page-heading changelog-version-surface">
      <div>
        <span className="changelog-version">版本更新</span>
        <h1>HitMuse 1.0.0</h1>
        <p>从发现爆款、理解内容到形成自己的创作方向，工作流现在可以在桌面应用与飞书之间自动衔接。</p>
      </div>
      <time dateTime="2026-08-08">2026 年 8 月 8 日</time>
    </header>

    <section aria-labelledby="release-features-title" className="changelog-content-surface">
      <div className="changelog-section__heading">
        <div><h2 id="release-features-title">本次更新</h2><p>三个能力直接进入日常创作流程。</p></div>
      </div>
      <div className="release-features">
        {RELEASE_FEATURES.map(({ title, description, icon: Icon }) => <article key={title}>
          <Icon aria-hidden="true" size={20} />
          <div><h3>{title}</h3><p>{description}</p></div>
        </article>)}
      </div>
    </section>

    <section aria-labelledby="feishu-data-title" className="changelog-content-surface changelog-section--feishu">
      <div className="changelog-section__heading">
        <div><h2 id="feishu-data-title">飞书中会呈现什么</h2><p>同步的不只是作品列表，也包括判断、拆解和趋势。</p></div>
      </div>
      <dl className="feishu-data-list">
        {FEISHU_DATA.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}
      </dl>
      <div className="tutorial-action">
        <div><strong>第一次接入？</strong><span>按图完成自建应用、权限、模板和连接配置。</span></div>
        <Button icon={<ExternalLink size={16} />} onClick={() => void window.desktopApi.openExternal(FEISHU_TUTORIAL_URL)} variant="secondary">
          查看飞书接入教程
        </Button>
      </div>
    </section>
  </div>
}
