import { Radar } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <section className="empty-state">
      <span className="empty-state__icon" aria-hidden="true"><Radar size={22} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div style={{ marginTop: 20 }}>{action}</div> : null}
    </section>
  )
}
