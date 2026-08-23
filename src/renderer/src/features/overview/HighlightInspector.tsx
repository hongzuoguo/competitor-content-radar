import { ExternalLink, X } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DashboardHighlight } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { useModalDialog } from '../../hooks/useModalDialog'
import { RADAR_STATUS_LABELS, REASON_LABELS } from './HighlightList'

export function HighlightInspector({ highlight, onClose }: { highlight: DashboardHighlight; onClose(): void }): React.JSX.Element {
  const closeButton = useRef<HTMLButtonElement>(null)
  const inspector = useRef<HTMLElement>(null)
  useModalDialog({ containerRef: inspector, initialFocusRef: closeButton, onClose })

  return createPortal(<div className="inspector-layer">
    <button className="inspector-scrim" aria-label="点击背景关闭详情" onClick={onClose} tabIndex={-1} type="button" />
    <aside aria-label="爆款拆解" aria-modal="true" className="inspector" ref={inspector} role="dialog">
      <header className="inspector__header">
        <div><span>{highlight.creatorName}</span><h2>{highlight.title}</h2></div>
        <Button aria-label="关闭详情" icon={<X size={18} />} onClick={onClose} ref={closeButton} variant="ghost" />
      </header>
      <div className="inspector__body">
        {highlight.radarStatus ? <section><h3>雷达状态</h3><div className="radar-evidence">
          <span className={`radar-status radar-status--${highlight.radarStatus}`}>{RADAR_STATUS_LABELS[highlight.radarStatus]}</span>
          {(highlight.radarEvidence ?? []).length > 0 ? <ul>{highlight.radarEvidence?.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul> : <p>等待更多每日数据确认变化趋势。</p>}
        </div></section> : null}
        <section><h3>入榜依据</h3><div className="reason-grid">
          {highlight.reasons.map((reason) => <span key={reason}><strong>{REASON_LABELS[reason]}</strong>{reason === 'absolute_high_likes' ? '点赞量已达到 10,000' : `达到该博主基线的 ${highlight.relativePerformanceMultiplier} 倍`}</span>)}
        </div></section>
        <section><h3>当前数据</h3><dl className="inspector__metrics">
          <div><dt>点赞</dt><dd>{highlight.likes.toLocaleString('zh-CN')}</dd></div>
          <div><dt>评论</dt><dd>{highlight.comments.toLocaleString('zh-CN')}</dd></div>
          <div><dt>相对表现</dt><dd>{highlight.relativePerformanceMultiplier !== null ? `${highlight.relativePerformanceMultiplier}×` : '样本不足'}</dd></div>
        </dl></section>
        {highlight.analysis ? <section className="analysis-detail"><h3>AI 拆解</h3><dl>
          <div><dt>选题分类</dt><dd>{highlight.analysis.topicCategory ?? '未分类'}</dd></div>
          <div><dt>角度</dt><dd>{highlight.analysis.topicAngle}</dd></div>
          <div><dt>钩子</dt><dd>{highlight.analysis.openingHook.quote}</dd></div>
          <div><dt>结构</dt><dd>{highlight.analysis.structure.join('；')}</dd></div>
          <div><dt>爆点</dt><dd>{highlight.analysis.viralPoints.join('；')}</dd></div>
          <div><dt>亮点</dt><dd>{[...highlight.analysis.highlights, ...highlight.analysis.reusablePatterns].join('；')}</dd></div>
        </dl></section> : <section><h3>AI 拆解</h3><p className="inspector__summary">该作品已入榜，正在等待拆解或可在作品页手动执行。</p></section>}
      </div>
      <footer className="inspector__footer"><Button disabled={!highlight.originalUrl} icon={<ExternalLink size={16} />} onClick={() => void window.desktopApi?.openExternal(highlight.originalUrl)}>打开原作</Button></footer>
    </aside>
  </div>, document.body)
}
