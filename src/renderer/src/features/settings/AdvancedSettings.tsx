import type { ReactNode } from 'react'

interface AdvancedSettingsProps {
  title: string
  children: ReactNode
}

export function AdvancedSettings({ title, children }: AdvancedSettingsProps): React.JSX.Element {
  return (
    <details className="settings-disclosure">
      <summary>{title}</summary>
      <div className="settings-disclosure__content">{children}</div>
    </details>
  )
}
