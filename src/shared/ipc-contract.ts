import type { HighlightReason } from '../core/highlight-rules'

export const IPC_CHANNELS = {
  appMetadata: 'app:metadata',
  dashboard: 'dashboard:get',
  runNow: 'runs:start-now',
  openExternal: 'system:open-external'
} as const

export interface DashboardHighlight {
  id: string
  creatorName: string
  title: string
  publishedAt: string
  likes: number
  relativeViralIndex: number | null
  referenceValueScore: number | null
  reasons: HighlightReason[]
  summary: string
  originalUrl: string
}

export interface DashboardData {
  lastRunAt: string | null
  nextRunAt: string
  creators: number
  newWorks: number
  analyzedWorks: number
  highlights: DashboardHighlight[]
}
