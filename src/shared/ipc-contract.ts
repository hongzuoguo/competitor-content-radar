import type { HighlightReason } from '../core/highlight-rules'

export const IPC_CHANNELS = {
  appMetadata: 'app:metadata',
  dashboard: 'dashboard:get',
  runNow: 'runs:start-now',
  openExternal: 'system:open-external',
  creatorList: 'creators:list',
  creatorAdd: 'creators:add',
  creatorToggle: 'creators:toggle',
  douyinLogin: 'douyin:login',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save'
} as const

export interface CreatorView {
  id: string
  name: string
  profileUrl: string
  enabled: boolean
  works: number
  lastRun: string
  status: 'ready' | 'waiting' | 'attention'
}

export interface PublicSettings {
  providerId?: string
  modelId?: string
  customBaseUrl?: string
  dailyTime?: string
  weeklyTime?: string
  absoluteLikes?: number
  relativeViralIndex?: number
  referenceValueScore?: number
  mediaRetentionDays?: number
  feishuConnected?: boolean
  douyinLoggedIn?: boolean
}

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
  analysis?: {
    topicAngle: string
    openingHook: string
    structure: string
    reusablePattern: string
    differentiatedSuggestion: string
    risk: string
  }
}

export type DashboardState = 'pending' | 'running' | 'completed' | 'failed'

export interface DashboardRun {
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed'
  message: string
  requiresAction: boolean
  stages: Array<{ id: string; label: string; status: DashboardState }>
}

export interface DashboardService {
  id: string
  label: string
  status: 'healthy' | 'unavailable' | 'action_required'
  detail: string
  actionLabel?: string
}

export interface DashboardData {
  lastRunAt: string | null
  nextRunAt: string
  creators: number
  newWorks: number
  analyzedWorks: number
  run: DashboardRun
  services: DashboardService[]
  highlights: DashboardHighlight[]
}
