import type { HighlightReason } from '../core/highlight-rules'

export const IPC_CHANNELS = {
  appMetadata: 'app:metadata',
  dashboard: 'dashboard:get',
  runNow: 'runs:start-now',
  openExternal: 'system:open-external',
  creatorList: 'creators:list',
  creatorAdd: 'creators:add',
  creatorDelete: 'creators:delete',
  creatorToggle: 'creators:toggle',
  douyinLogin: 'douyin:login',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  updateGet: 'updates:get',
  updateRetry: 'updates:retry',
  updateStateChanged: 'updates:state-changed',
  importPickLocal: 'imports:pick-local',
  importStart: 'imports:start',
  importRetry: 'imports:retry',
  workList: 'works:list',
  workDeleteFailed: 'works:delete-failed',
  workStateChanged: 'works:state-changed',
  workFocusRequested: 'works:focus-requested'
} as const

export interface ImportRequest {
  source:
    | { type: 'local'; path: string }
    | { type: 'douyin_url'; url: string }
  creatorId?: string | null
}

export type ImportStartResult = { accepted: true; workId: string }

export interface WorkFocusRequest {
  workId: string
  requestId: string
}

export type ImportInvokeResult =
  | { ok: true; value: ImportStartResult }
  | {
      ok: false
      error: { code: string; message: string; action?: string; retryable?: boolean }
    }

export type DeleteFailedWorkInvokeResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

export interface WorkListItem {
  id: string
  creatorId: string | null
  creatorName: string
  title: string
  sourceType: 'douyin_monitor' | 'douyin_url' | 'local_file'
  publishedAt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: import('../core/workflow').WorkflowStage
  errorCode: string | null
  errorMessage: string | null
  retryable: boolean
  existingWorkId?: string
  likes: number
  relativeViralIndex: number | null
  referenceValueScore: number | null
  reasons: HighlightReason[]
}

export type UpdateState =
  | { status: 'idle' | 'checking' | 'up_to_date' | 'installing' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'waiting_for_idle'; version: string }
  | { status: 'error'; message: string }

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
