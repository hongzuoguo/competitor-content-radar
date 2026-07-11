import { ExternalLink, FileSpreadsheet, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DashboardHighlight } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { REASON_LABELS } from './HighlightList'

export function HighlightInspector({
  highlight,
  onClose
}: {
  highlight: DashboardHighlight
  onClose(): void
}): React.JSX.Element {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appShell = document.querySelector('.app-shell') as (HTMLElement & { inert: boolean }) | null
    if (appShell) {
      appShell.inert = true
      appShell.setAttribute('inert', '')
    }
    closeButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      if (appShell) {
        appShell.inert = false
        appShell.removeAttribute('inert')
      }
      previouslyFocused?.focus()
    }
  }, [onClose])

  function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="inspector-layer">
      <button className="inspector-scrim" aria-label="点击背景关闭详情" onClick={onClose} type="button" />
      <aside aria-label="作品拆解摘要" aria-modal="true" className="inspector" onKeyDown={trapFocus} role="dialog">
        <header className="inspector__header">
          <div><span>{highlight.creatorName}</span><h2>{highlight.title}</h2></div>
          <Button aria-label="关闭详情" icon={<X size={18} />} onClick={onClose} ref={closeButton} variant="ghost" />
        </header>
        <div className="inspector__body">
          <section>
            <h3>为什么值得看</h3>
            <div className="reason-grid">
              {highlight.reasons.map((reason) => (
                <span key={reason}><strong>{REASON_LABELS[reason]}</strong>{reason === 'absolute_high_likes' ? '点赞量已超过 10,000' : reason === 'relative_viral' ? `达到该博主基线的 ${highlight.relativeViralIndex}%` : `借鉴价值评分 ${highlight.referenceValueScore}`}</span>
              ))}
            </div>
          </section>
          <section>
            <h3>内容判断</h3>
            <p className="inspector__summary">{highlight.summary}</p>
          </section>
          {highlight.analysis ? <section className="analysis-detail">
            <h3>可借鉴内容</h3>
            <dl>
              <div><dt>选题角度</dt><dd>{highlight.analysis.topicAngle}</dd></div>
              <div><dt>开头钩子</dt><dd>{highlight.analysis.openingHook}</dd></div>
              <div><dt>内容结构</dt><dd>{highlight.analysis.structure}</dd></div>
              <div><dt>可复用模式</dt><dd>{highlight.analysis.reusablePattern}</dd></div>
              <div><dt>差异化建议</dt><dd>{highlight.analysis.differentiatedSuggestion}</dd></div>
              <div><dt>借鉴风险</dt><dd>{highlight.analysis.risk}</dd></div>
            </dl>
          </section> : null}
          <section>
            <h3>当前数据</h3>
            <dl className="inspector__metrics">
              <div><dt>点赞量</dt><dd>{highlight.likes.toLocaleString('zh-CN')}</dd></div>
              <div><dt>相对爆款</dt><dd>{highlight.relativeViralIndex !== null ? `${highlight.relativeViralIndex}%` : '样本不足'}</dd></div>
              <div><dt>借鉴评分</dt><dd>{highlight.referenceValueScore !== null ? `${highlight.referenceValueScore}/100` : '待分析'}</dd></div>
            </dl>
          </section>
        </div>
        <footer className="inspector__footer">
          <Button icon={<ExternalLink size={16} />} onClick={() => void window.desktopApi?.openExternal(highlight.originalUrl)}>打开抖音原视频</Button>
          <Button disabled icon={<FileSpreadsheet size={16} />} variant="secondary">同步后在飞书查看</Button>
        </footer>
      </aside>
    </div>,
    document.body
  )
}
