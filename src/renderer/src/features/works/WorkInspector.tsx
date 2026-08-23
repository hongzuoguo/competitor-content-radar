import { Copy, ExternalLink, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { RewriteResultView, WorkDetail } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { stableWorkErrorMessage } from './WorkStatusRow'

type InspectorTab = 'analysis' | 'transcript' | 'trend'

/** Per-work rewrite session state, persisted across detail switches. */
interface RewriteCache {
  context: string
  wordCount: string
  state: 'idle' | 'loading'
  result: RewriteResultView | null
  /** All generated versions, newest last. result mirrors the last entry. */
  versions: RewriteResultView[]
  error: string
  copied: boolean
  pendingQuestions: string[]
  answers: string
  followUp: { questions: string[]; answers: string } | undefined
}

const EMPTY_REWRITE_CACHE: RewriteCache = {
  context: '',
  wordCount: '',
  state: 'idle',
  result: null,
  versions: [],
  error: '',
  copied: false,
  pendingQuestions: [],
  answers: '',
  followUp: undefined
}

export function WorkInspector({ workId, revision = 0 }: { workId: string | null; revision?: number }): React.JSX.Element {
  const [detail, setDetail] = useState<WorkDetail | null>(null)
  const [state, setState] = useState<'empty' | 'loading' | 'ready' | 'failed'>('empty')
  const [tab, setTab] = useState<InspectorTab>('analysis')
  const [copyMessage, setCopyMessage] = useState('')
  const [analysisAction, setAnalysisAction] = useState<'idle' | 'loading' | 'accepted' | 'error'>('idle')
  const [analysisError, setAnalysisError] = useState('')
  // RewriteSection state is keyed by workId so switching works and coming back
  // restores the user's context, pending questions, and last result.
  const [rewriteCaches, setRewriteCaches] = useState<Record<string, RewriteCache>>({})
  const tabIdPrefix = useId()

  useEffect(() => {
    let active = true
    setDetail(null)
    setCopyMessage('')
    setAnalysisAction('idle')
    setAnalysisError('')
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

  async function analyzeManually(): Promise<void> {
    if (!detail?.canAnalyzeManually || analysisAction === 'loading') return
    setAnalysisAction('loading')
    setAnalysisError('')
    try {
      const result = await window.desktopApi.analyzeWork(detail.id)
      setAnalysisAction(result.accepted ? 'accepted' : 'error')
      if (!result.accepted) setAnalysisError(manualAnalysisError(result.reason))
    } catch {
      setAnalysisAction('error')
      setAnalysisError('手动拆解启动失败，请稍后重试。')
    }
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
          {detail.canAnalyzeManually && !detail.analysis ? <div className="work-inspector__actions"><Button disabled={analysisAction === 'loading' || analysisAction === 'accepted'} onClick={() => void analyzeManually()}>{analysisAction === 'loading' ? '正在启动…' : analysisAction === 'accepted' ? '拆解已启动' : detail.status === 'failed' ? '重试拆解' : '手动拆解'}</Button>{analysisError ? <span className="form-error" role="alert">{analysisError}</span> : null}</div> : null}
        </header>
        <dl className="work-inspector__metrics">
          <Metric label="点赞" value={detail.likes.toLocaleString('zh-CN')} />
          <Metric label="评论" value={detail.comments.toLocaleString('zh-CN')} />
          <Metric label="收藏" value={detail.collects.toLocaleString('zh-CN')} />
          <Metric label="转发" value={detail.shares.toLocaleString('zh-CN')} />
          <Metric label="相对表现" value={detail.relativePerformanceMultiplier !== null ? `${detail.relativePerformanceMultiplier}×` : '—'} />
        </dl>
        {detail.analysis ? <RewriteSection detail={detail} cache={rewriteCaches[detail.id] ?? EMPTY_REWRITE_CACHE} onChange={(updater) => setRewriteCaches((prev) => ({ ...prev, [detail.id]: updater(prev[detail.id] ?? EMPTY_REWRITE_CACHE) }))} /> : null}
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
        {detail.originalUrl ? <footer className="work-inspector__footer"><Button aria-label="打开原作" icon={<ExternalLink size={15} />} onClick={() => { if (detail.originalUrl) void window.desktopApi.openExternal(detail.originalUrl) }} variant="secondary">打开原作</Button></footer> : null}
      </> : null}
    </section>
  )
}

function manualAnalysisError(reason?: string): string {
  if (reason === 'AGENT_CLI_NOT_FOUND') return '未检测到可用的本地 Codex，请到设置中重新检测并确认已登录。'
  if (reason === 'MODEL_NOT_CONFIGURED') return '云端模型未配置，请到设置中配置模型后重试。'
  if (reason === 'ANALYSIS_IN_PROGRESS') return '该作品正在拆解，请稍候。'
  if (reason === 'ALREADY_ANALYZED') return '该作品已经完成拆解。'
  return '手动拆解未能启动，请稍后重试。'
}

function AnalysisPanel({ detail }: { detail: WorkDetail }): React.JSX.Element {
  if (detail.status === 'failed') return <InspectorState title="拆解失败" detail={stableWorkErrorMessage(detail)} alert />
  if (detail.status === 'running') {
    return <InspectorState title="正在处理" detail={detail.progressLabel ?? '正在处理作品，完成后会在这里显示五项拆解。'} />
  }
  if (!detail.analysis) {
    if (detail.stage === 'transcribed') return <InspectorState title="等待 AI 拆解" detail="文字稿已准备好，配置模型后会继续生成拆解。" />
    return <InspectorState title="尚未拆解" detail={detail.canAnalyzeManually ? '该作品未触发自动拆解，可点击“手动拆解”。' : '作品正在处理中，完成后会在这里显示五项拆解。'} />
  }
  const analysis = detail.analysis
  const sections = [
    ['角度', analysis.topicAngle],
    ['钩子', `${analysis.openingHook.quote}（${analysis.openingHook.type}：${analysis.openingHook.mechanism}）`],
    ['结构', analysis.structure],
    ['爆点', analysis.viralPoints],
    ['亮点', [...analysis.highlights, ...analysis.reusablePatterns]]
  ] as const
  return <div className="analysis-sections">{sections.map(([title, content]) => <section key={title}><h3>{title}</h3>{Array.isArray(content) ? <ul>{content.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{content}</p>}</section>)}</div>
}

function Tab({ active, controls, id, onSelect, children }: { active: boolean; controls: string; id: string; onSelect(): void; children: React.ReactNode }): React.JSX.Element {
  return <button aria-controls={controls} aria-selected={active} id={id} onClick={onSelect} role="tab" tabIndex={active ? 0 : -1} type="button">{children}</button>
}

/** Rewrites a competitor's article using Humanizer-zh de-AI rules + user context. */
function RewriteSection({ detail, cache, onChange }: { detail: WorkDetail; cache: RewriteCache; onChange(updater: (prev: RewriteCache) => RewriteCache): void }): React.JSX.Element | null {
  if (typeof window.desktopApi?.rewriteWork !== 'function') return null
  const analysis = detail.analysis
  // Functional updater: generate() issues several updates in one tick
  // (needMore/pendingQuestions write, then finally { state: 'idle' }). With a
  // value-based onChange each write spreads the render-time cache closure, so
  // the later update wipes the pendingQuestions the earlier one set — the UI
  // then shows nothing after the Agent actually answered. Always merge onto
  // the latest prev instead.
  const update = (patch: Partial<RewriteCache>): void => onChange((prev) => ({ ...prev, ...patch }))

  async function generate(): Promise<void> {
    if (!analysis || cache.state === 'loading') return
    update({ state: 'loading', error: '', copied: false })
    try {
      const res = await window.desktopApi.rewriteWork(detail.id, {
        title: detail.title,
        topicAngle: analysis.topicAngle,
        openingHookQuote: analysis.openingHook.quote,
        openingHookType: analysis.openingHook.type,
        openingHookMechanism: analysis.openingHook.mechanism,
        structure: analysis.structure.join(' / '),
        viralPoints: analysis.viralPoints.join(' / '),
        highlights: analysis.highlights,
        reusablePatterns: analysis.reusablePatterns,
        userContext: cache.context,
        wordCount: cache.wordCount ? Number(cache.wordCount) : undefined,
        followUp: cache.followUp
      })
      if (res.needMore) {
        update({ result: null, pendingQuestions: res.questions, answers: '' })
      } else {
        // Append as a new version; result shows the latest one.
        update({ result: res, versions: [...cache.versions, res], pendingQuestions: [], followUp: undefined })
        setViewIndex(null)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[rewrite] failed:', e)
      update({ error: e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : '生成失败' })
    } finally {
      update({ state: 'idle' })
    }
  }

  async function answerAndContinue(): Promise<void> {
    if (cache.pendingQuestions.length === 0 || !cache.answers.trim() || cache.state === 'loading') return
    update({
      followUp: { questions: cache.pendingQuestions, answers: cache.answers },
      pendingQuestions: []
    })
    await generate()
  }

  async function copy(): Promise<void> {
    if (!cache.result?.content) return
    try {
      await navigator.clipboard.writeText(cache.result.content)
      update({ copied: true })
    } catch { update({ copied: false }) }
  }

  // Which version is being displayed (null = newest). Local view state only.
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const currentResult = viewIndex !== null && viewIndex >= 0 && viewIndex < cache.versions.length
    ? cache.versions[viewIndex]
    : cache.result

  return (
    <section className="rewrite-section">
      <header>
        <h3>一键改写文案</h3>
        <p>基于拆解的 5 项 + 你的个性化背景,生成去 AI 痕迹的全新文案(不参考原文)。</p>
      </header>
      <textarea
        aria-label="一句话说明"
        className="rewrite-context"
        onChange={(event) => update({ context: event.target.value })}
        placeholder="一句话说明下你要写什么文案,如:作为AI博主去教大家用内容创作神器找选题创作文章"
        rows={3}
        value={cache.context}
      />
      <div className="rewrite-options">
        <label htmlFor="rewrite-word-count">
          字数
          <input
            id="rewrite-word-count"
            className="rewrite-word-count"
            inputMode="numeric"
            min={100}
            max={2000}
            onChange={(event) => update({ wordCount: event.target.value.replace(/\D/g, '') })}
            placeholder="400"
            type="number"
            value={cache.wordCount}
          />
        </label>
        <Button disabled={cache.state === 'loading'} icon={cache.state === 'loading' ? <LoaderCircle size={15} className="rewrite-spin" /> : <Sparkles size={15} />} onClick={() => void generate()}>
          {cache.state === 'loading' ? '正在生成…' : '生成文案'}
        </Button>
      </div>
      {cache.error ? <p className="rewrite-error" role="alert">{cache.error}</p> : null}
      {cache.pendingQuestions.length > 0 ? (
        <div className="rewrite-ask" role="alert">
          <strong>还想再了解一点背景,才能写得更好:</strong>
          <ul>{cache.pendingQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
          <textarea
            aria-label="补充背景"
            className="rewrite-context"
            onChange={(event) => update({ answers: event.target.value })}
            placeholder="在这里补充回答上面的问题…"
            rows={3}
            value={cache.answers}
          />
          <Button disabled={!cache.answers.trim() || cache.state === 'loading'} onClick={() => void answerAndContinue()}>
            {cache.state === 'loading' ? '正在生成…' : '补充后继续生成'}
          </Button>
        </div>
      ) : null}
      {currentResult?.needMore === false && currentResult.content && currentResult.score ? (
        <div className="rewrite-result">
          <div className="rewrite-result__meta">
            <span>改写文案{viewIndex !== null ? `(第 ${viewIndex + 1} 版)` : cache.versions.length > 1 ? `(最新,共 ${cache.versions.length} 版)` : ''}</span>
            <span className="rewrite-score">质量 {currentResult.score.total}/50</span>
            <Button disabled={!currentResult.content} icon={<Copy size={14} />} onClick={() => void copy()} variant="secondary">
              {cache.copied ? '已复制' : '复制'}
            </Button>
          </div>
          {cache.versions.length > 1 ? (
            <div className="rewrite-versions">
              <span>对比上一次:</span>
              {cache.versions.map((_, index) => (
                <button
                  className={`rewrite-version-btn ${index === (viewIndex ?? cache.versions.length - 1) ? 'is-active' : ''}`}
                  key={index}
                  onClick={() => setViewIndex(index)}
                  type="button"
                >
                  第 {index + 1} 版
                </button>
              ))}
              <button className={`rewrite-version-btn ${viewIndex === null ? 'is-active' : ''}`} onClick={() => setViewIndex(null)} type="button">最新</button>
            </div>
          ) : null}
          <p className="rewrite-result__body">{currentResult.content}</p>
          <p className="rewrite-result__score" aria-label="改写质量评分">
            直接性 {currentResult.score.directness} · 节奏 {currentResult.score.rhythm} · 信任 {currentResult.score.trust} · 真实 {currentResult.score.authenticity} · 精炼 {currentResult.score.refinement}
          </p>
        </div>
      ) : null}
    </section>
  )
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
