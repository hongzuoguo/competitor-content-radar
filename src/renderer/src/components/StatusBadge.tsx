import type { ReactNode } from 'react'

export function StatusBadge({
  tone = 'neutral',
  children
}: {
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
  children: ReactNode
}): React.JSX.Element {
  return <span className="status-badge" data-tone={tone} title={typeof children === 'string' ? children : undefined}>{children}</span>
}
