import { Copy, ExternalLink } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { WorkDetail } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { stableWorkErrorMessage } from './WorkStatusRow'

type InspectorTab = 'analysis' | 'transcript' | 'trend'

export function WorkInspector({ workId, revision = 0 }: { workId: string | null; revision?: number }): React.JSX.Element {
  const [detail, setDetail] = useState<WorkDetail | null>(null)
  const [state, setState] = useState<'empty' | 'loading' | 'ready' | 'failed'>('empty')
  const [tab, setTab] = useState<InspectorTab>('analysis')
  const [copyMessage, setCopyMessage] = useState('')
  const tabIdPrefix = useId()

  useEffect(() => {
    let active = true
    setDetail(null)
    setCopyMessage('')
    setTab('analysis')
    if (!workId) { setState('empty'); return () => { active = false } }
    setState('loading')
    if (typeof window.desktopApi?.getWork !== 'function') { setState('failed'); return () => { active = false } }
    void window.desktopApi.getWork(workId).then((value) => {
      if (!active) return
      setDetail(value)
      setState(value ? 'ready' : 'failed')
    }).catch(() => { if (active) setState('failed') })
    return () => { active = false }
  }, [revision, workId])

  async function copyTranscript(): Promise<void> {
    if (!detail?.transcript) return
    try {
      await navigator.clipboard.writeText(detail.transcript)
      setCopyMessage('文案已复制')
    } catch { setCopyMessage('复制失败，请手动选择文案') }
  }

  const detailMatchesSelection = detail?.id === workId

  return (
    <section aria-labelledby="subscription-inspector-title" className="work-inspector">
      <span className="visually-hidden" id="subscription-inspector-title">作品详情</span>
      {state === 'empty' ? <InspectorState title="选择一条作品" detail="这里会显示指标、文字稿和 AI 拆解。" /> : null}
      {state === 'loading' || (state === 'ready' && !detailMatchesSelection) ? <div aria-label="正在加载作品详情" className="inspector-loading" role="status"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div> : null}
      {state === 'failed' ? <InspectorState title="作品详情加载失败" detail="本地记录暂时无法读取，请重新选择或稍后再试。" alert /> : null}
      {state === 'ready' && detail && detailMatchesSelection ? <>
        <header className="work-inspector__heading">
          <div><p>{detail.creatorName}</p><h2>{detail.title}</h2></div>
          {detail.originalUrl ? <Button aria-label="打开原作" icon={<ExternalLink size={15} />} onClick={() => { if (detail.originalUrl) void window.desktopApi.openExternal(detail.originalUrl) }} variant="secondary">打开原作</Button> : null}
        </header>
        <dl className="work-inspector__metrics">
          <Metric label="点赞" value={detail.likes.toLocaleString('zh-CN')} />
          <Metric label="评论" value={detail.comments.toLocaleString('zh-CN')} />
          <Metric label="收藏" value={detail.collects.toLocaleString('zh-CN')} />
          <Metric label="转发" value={detail.shares.toLocaleString('zh-CN')} />
          <Metric label="爆款指数" value={detail.relativeViralIndex?.toString() ?? '—'} />
          <Metric label="借鉴评分" value={detail.referenceValueScore?.toString() ?? '—'} />
        </dl>
        <p className="work-inspector__reason"><strong>判断依据</strong>{decisionReason(detail)}</p>
        <div aria-label="作品详情视图" className="inspector-tabs" onKeyDown={(event) => handleTabKeyDown(event, setTab)} role="tablist">
          <Tab active={tab === 'analysis'} controls={`${tabIdPrefix}-analysis-panel`} id={`${tabIdPrefix}-analysis-tab`} onSelect={() => setTab('analysis')}>AI 拆解</Tab>
          <Tab active={tab === 'transcript'} controls={`${tabIdPrefix}-transcript-panel`} id={`${tabIdPrefix}-transcript-tab`} onSelect={() => setTab('transcript')}>完整文案</Tab>
          <Tab active={tab === 'trend'} controls={`${tabIdPrefix}-trend-panel`} id={`${tabIdPrefix}-trend-tab`} onSelect={() => setTab('trend')}>数据趋势</Tab>
        </div>
        <div aria-labelledby={`${tabIdPrefix}-${tab}-tab`} id={`${tabIdPrefix}-${tab}-panel`} role="tabpanel" tabIndex={0}>
          {tab === 'analysis' ? <AnalysisPanel detail={detail} /> : null}
          {tab === 'transcript' ? <section className="transcript-panel">
            <div><h3>完整文案</h3><Button disabled={!detail.transcript} icon={<Copy size={14} />} onClick={() => void copyTranscript()} variant="secondary">复制文案</Button></div>
            {copyMessage ? <p aria-live="polite">{copyMessage}</p> : null}
            <p>{detail.transcript ?? '文字稿尚未生成。'}</p>
          </section> : null}
          {tab === 'trend' ? <InspectorState title="数据趋势" detail="持续采集后，这里会展示点赞、评论、收藏和转发的变化。" /> : null}
        </div>
      </> : null}
    </section>
  )
}

function AnalysisPanel({ detail }: { detail: WorkDetail }): React.JSX.Element {
  if (detail.status === 'failed') return <InspectorState title="拆解失败" detail={stableWorkErrorMessage(detail)} alert />
  if (!detail.analysis) {
    if (detail.stage === 'transcribed') return <InspectorState title="等待 AI 拆解" detail="文字稿已准备好，配置模型后会继续生成拆解。" />
    return <InspectorState title="分析尚未完成" detail="作品正在处理中，完成后会在这里显示六项拆解。" />
  }
  const analysis = detail.analysis
  const sections = [
    ['选题角度', analysis.topicAngle],
    ['开头钩子', `${analysis.openingHook.quote}（${analysis.openingHook.type}：${analysis.openingHook.mechanism}）`],
    ['内容结构', analysis.structure],
    ['视频爆点', analysis.viralPoints],
    ['互动引导', analysis.interactionGuidance],
    ['亮点内容', [...analysis.highlights, ...analysis.reusablePatterns]]
  ] as const
  return <div className="analysis-sections">{sections.map(([title, content]) => <section key={title}><h3>{title}</h3>{Array.isArray(content) ? <ul>{content.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{content}</p>}</section>)}</div>
}

function Tab({ active, controls, id, onSelect, children }: { active: boolean; controls: string; id: string; onSelect(): void; children: React.ReactNode }): React.JSX.Element {
  return <button aria-controls={controls} aria-selected={active} id={id} onClick={onSelect} role="tab" tabIndex={active ? 0 : -1} type="button">{children}</button>
}

function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>, selectTab: (tab: InspectorTab) => void): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const currentIndex = tabs.indexOf(event.target as HTMLButtonElement)
  if (currentIndex < 0) return
  event.preventDefault()
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const nextTab = tabs[nextIndex]
  const nextValue: InspectorTab = nextIndex === 0 ? 'analysis' : nextIndex === 1 ? 'transcript' : 'trend'
  selectTab(nextValue)
  nextTab.focus()
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function InspectorState({ title, detail, alert = false }: { title: string; detail: string; alert?: boolean }): React.JSX.Element {
  return <div className="inspector-state" role={alert ? 'alert' : undefined}><strong>{title}</strong><p>{detail}</p></div>
}

function decisionReason(detail: WorkDetail): string {
  if (detail.analysis?.referenceValueReason) return detail.analysis.referenceValueReason
  const reasons: string[] = []
  if (detail.reasons.includes('absolute_high_likes')) reasons.push('点赞超过绝对阈值')
  if (detail.reasons.includes('relative_viral')) reasons.push('表现显著高于该博主基线')
  if (detail.reasons.includes('high_reference_value')) reasons.push('借鉴评分较高')
  return reasons.length > 0 ? reasons.join('，') : '当前没有触发重点判断标准。'
}
