import { ArrowRight, X } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DashboardHighlight } from '../../../../shared/ipc-contract'
import { Button } from '../../components/Button'
import { useModalDialog } from '../../hooks/useModalDialog'
import { RADAR_STATUS_LABELS } from './HighlightList'

export function TopicWorksInspector({ topic, highlights, onClose, onSelect }: {
  topic: string
  highlights: DashboardHighlight[]
  onClose(): void
  onSelect(workId: string): void
}): React.JSX.Element {
  const closeButton = useRef<HTMLButtonElement>(null)
  const inspector = useRef<HTMLElement>(null)
  useModalDialog({ containerRef: inspector, initialFocusRef: closeButton, onClose })

  return createPortal(<div className="inspector-layer">
    <button className="inspector-scrim" aria-label="点击背景关闭分类作品列表" onClick={onClose} tabIndex={-1} type="button" />
    <aside aria-label={`${topic}分类作品`} aria-modal="true" className="inspector inspector--topic-works" ref={inspector} role="dialog">
      <header className="inspector__header">
        <div><span>选题分类</span><h2>{topic}</h2><p>{highlights.length} 条爆款作品</p></div>
        <Button aria-label="关闭分类作品列表" icon={<X size={18} />} onClick={onClose} ref={closeButton} variant="ghost" />
      </header>
      <div className="inspector__body topic-works">
        {highlights.length > 0 ? <ul>{highlights.map((highlight) => <li key={highlight.id}>
          <button onClick={() => onSelect(highlight.id)} type="button">
            <span className="topic-work__identity"><small>{highlight.creatorName}</small><strong>{highlight.title}</strong>{highlight.radarStatus && highlight.radarStatus !== 'watching' ? <span className={`radar-status radar-status--${highlight.radarStatus}`}>{RADAR_STATUS_LABELS[highlight.radarStatus]}</span> : null}</span>
            <span className="topic-work__metrics">
              <small>{highlight.likes.toLocaleString('zh-CN')} 点赞</small>
              <small>{highlight.relativePerformanceMultiplier !== null ? `${highlight.relativePerformanceMultiplier}× 相对表现` : '基线样本不足'}</small>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </li>)}</ul> : <div className="topic-works__empty"><strong>该分类作品已不存在</strong><p>请关闭后刷新雷达数据。</p></div>}
      </div>
    </aside>
  </div>, document.body)
}
