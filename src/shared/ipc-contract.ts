import type { HighlightReason } from '../core/highlight-rules'
import type { RadarStatus } from '../core/radar-status'
import type { AnalysisResult } from '../services/ai/analysis-schema'
import type { WorkOwnership } from '../core/domain'
import type { ModelProfileInput } from '../services/ai/model-profile'
import type { ConnectionTestResult, ModelProfileView } from '../services/ai/model-profile-service'

export const IPC_CHANNELS = {
  dashboard: 'dashboard:get',
  runNow: 'runs:start-now',
  runList: 'runs:list',
  runRetry: 'runs:retry',
  runRetryCreators: 'runs:retry-creators',
  runDelete: 'runs:delete',
  openExternal: 'system:open-external',
  creatorList: 'creators:list',
  creatorAdd: 'creators:add',
  creatorAddMine: 'creators:add-mine',
  creatorDelete: 'creators:delete',
  creatorToggle: 'creators:toggle',
  sourceClearUnclassified: 'sources:clear-unclassified',
  douyinLogin: 'douyin:login',
  douyinLogout: 'douyin:logout',
  douyinCheckLogin: 'douyin:check-login',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsRestoreRecommended: 'settings:restore-recommended',
  updateGet: 'updates:get',
  updateRetry: 'updates:retry',
  updateStateChanged: 'updates:state-changed',
  importPickLocal: 'imports:pick-local',
  importStart: 'imports:start',
  importRetry: 'imports:retry',
  workList: 'works:list',
  workGet: 'works:get',
  workAnalyze: 'works:analyze',
  workDeleteFailed: 'works:delete-failed',
  workStateChanged: 'works:state-changed',
  workFocusRequested: 'works:focus-requested',
  feishuGet: 'feishu:get',
  feishuConnectCustomApp: 'feishu:connect-custom-app',
  feishuDisconnect: 'feishu:disconnect',
  feishuSync: 'feishu:sync',
  feishuRepair: 'feishu:repair',
  feishuRecreate: 'feishu:recreate',
  feishuOpenBase: 'feishu:open-base',
  feishuOpenDeveloperConsole: 'feishu:open-developer-console',
  modelProfileList: 'modelProfiles:list',
  modelProfileCreate: 'modelProfiles:create',
  modelProfileUpdate: 'modelProfiles:update',
  modelProfileTest: 'modelProfiles:test',
  modelProfileActivate: 'modelProfiles:activate',
  modelProfileDelete: 'modelProfiles:delete',
  modelProfileDeleteKey: 'modelProfiles:deleteKey',
  engineHealthPeek: 'engine-health:peek',
  engineHealthGet: 'engine-health:get',
  engineHealthRefresh: 'engine-health:refresh',
  agentStatus: 'agent:status',
  agentDetectCli: 'agent:detect-cli',
  workRewrite: 'works:rewrite'
} as const

export type ModelProfileDraft = ModelProfileInput & { apiKey?: string }
export type ModelProfileConnectionTestRequest = ModelProfileDraft & { profileId?: string }
export type { ConnectionTestResult, ModelProfileView }

export type EngineHealthStatus = 'unknown' | 'checking' | 'healthy' | 'unhealthy'

export interface EngineHealthEntry {
  status: EngineHealthStatus
  checkedAt: string | null
  fingerprint: string | null
  code: string | null
  message: string | null
}

/** Persisted probe state only; it never contains credentials, prompts, or command output. */
export interface EngineHealthView {
  cloud: EngineHealthEntry
  codex: EngineHealthEntry
  checking: boolean
}

export interface RewriteRequestView {
  title: string
  topicAngle: string
  openingHookQuote: string
  openingHookType: string
  openingHookMechanism: string
  structure: string
  viralPoints: string
  highlights: string[]
  reusablePatterns: string[]
  userContext: string
  /** Desired output length in Chinese characters. Defaults to 400 when unset. */
  wordCount?: number
  /** Answers to the model's clarifying questions from the previous round. */
  followUp?: { questions: string[]; answers: string }
}

export interface RewriteScoreView {
  directness: number
  rhythm: number
  trust: number
  authenticity: number
  refinement: number
  total: number
}

export interface RewriteResultView {
  needMore: boolean
  questions: string[]
  content: string | null
  score: RewriteScoreView | null
}

export interface AgentStatusView {
  enabled: boolean
  running: boolean
  port: number | null
  address: string | null
  apiVersion: string
  error: string | null
}

/** Result of probing for an installed Codex CLI (for the settings page). */
export interface AgentCliDetectedView {
  id: string
  command: string
  displayName: string
}

export interface ImportRequest {
  source:
    | { type: 'local'; path: string }
    | { type: 'douyin_url'; url: string }
  creatorId?: string | null
  ownership?: WorkOwnership
}

export type FeishuConnectionStatus =
  | 'disconnected'
  | 'provisioning'
  | 'syncing_data'
  | 'connected'
  | 'needs_repair'
  | 'sync_error'

export interface FeishuCustomAppConnectionInput {
  appId: string
  appSecret: string
  baseUrl: string
}

export type FeishuErrorCode =
  | 'FEISHU_URL_INVALID'
  | 'FEISHU_WIKI_NOT_BITABLE'
  | 'FEISHU_PERMISSION_DENIED'
  | 'FEISHU_SECRET_INVALID'
  | 'FEISHU_NETWORK_ERROR'
  | 'FEISHU_BASE_MISSING'
  | 'FEISHU_UNKNOWN_ERROR'

export interface FeishuUserError {
  code: FeishuErrorCode
  title: string
  reason: string
  action: string
  retryable: boolean
}

const FEISHU_ERROR_COPY: Record<FeishuErrorCode, FeishuUserError> = {
  FEISHU_URL_INVALID: {
    code: 'FEISHU_URL_INVALID', title: '链接无法识别', reason: '不是有效的飞书多维表格链接',
    action: '请复制以 /base/ 或 /wiki/ 开头的完整链接', retryable: false
  },
  FEISHU_WIKI_NOT_BITABLE: {
    code: 'FEISHU_WIKI_NOT_BITABLE', title: '该知识库页面不是多维表格', reason: '页面实际类型不受支持',
    action: '请打开多维表格页面后重新复制链接', retryable: false
  },
  FEISHU_PERMISSION_DENIED: {
    code: 'FEISHU_PERMISSION_DENIED', title: '飞书拒绝了访问', reason: '应用权限未发布，或目标 Base 未授权该应用管理',
    action: '请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限', retryable: false
  },
  FEISHU_SECRET_INVALID: {
    code: 'FEISHU_SECRET_INVALID', title: '应用凭证无效', reason: 'App ID 或 App Secret 不匹配',
    action: '请重新复制凭证后测试', retryable: false
  },
  FEISHU_NETWORK_ERROR: {
    code: 'FEISHU_NETWORK_ERROR', title: '暂时无法连接飞书', reason: '网络、代理或飞书服务异常',
    action: '请检查网络后重试', retryable: true
  },
  FEISHU_BASE_MISSING: {
    code: 'FEISHU_BASE_MISSING', title: '已连接的飞书多维表格不存在', reason: '表格可能已被删除，或应用已失去访问权限',
    action: '请重新创建表格，或确认原表格仍可访问', retryable: false
  },
  FEISHU_UNKNOWN_ERROR: {
    code: 'FEISHU_UNKNOWN_ERROR', title: '飞书操作失败', reason: '未能确认具体原因',
    action: '请重试；如仍失败，请检查应用配置', retryable: true
  }
}

export function isFeishuErrorCode(value: unknown): value is FeishuErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEISHU_ERROR_COPY, value)
}

export function feishuUserErrorForCode(code: FeishuErrorCode): FeishuUserError {
  return { ...FEISHU_ERROR_COPY[code] }
}

export function feishuUserErrorFromUnknown(error: unknown): FeishuUserError | null {
  try {
    if (typeof error !== 'object' || error === null) return null
    const candidate = error as { code?: unknown; message?: unknown }
    const code = isFeishuErrorCode(candidate.code)
      ? candidate.code
      : isFeishuErrorCode(candidate.message)
        ? candidate.message
        : null
    return code ? feishuUserErrorForCode(code) : null
  } catch {
    return null
  }
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FeishuUserError }

export type FeishuSyncMode = 'auto' | 'manual'

export function isFeishuSyncMode(value: unknown): value is FeishuSyncMode {
  return value === 'auto' || value === 'manual'
}

export interface FeishuBaseCandidateView {
  appToken: string
  url: string
}

export interface FeishuConnectionView {
  status: FeishuConnectionStatus
  baseName: string | null
  baseUrl: string | null
  lastSyncedAt: string | null
  message: string
  customAppConfigured: boolean
  maskedAppId: string | null
  candidates?: FeishuBaseCandidateView[]
  mode?: FeishuSyncMode
  hasPendingChanges?: boolean
  localRevision?: number
  syncedRevision?: number
  lastSyncAttemptAt?: string | null
  lastSyncSucceededAt?: string | null
  lastErrorCode?: string | null
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

export type ManualAnalysisResult =
  | { accepted: true }
  | { accepted: false; reason: string }

export interface TargetedCreatorRetryRequest {
  runId: string
  creatorIds: string[]
}

export type RunStartResult = { accepted: boolean; reason?: string }

export interface WorkListItem {
  id: string
  creatorId: string | null
  creatorName: string
  title: string
  sourceType: 'douyin_monitor' | 'douyin_url' | 'local_file'
  ownership: WorkOwnership
  publishedAt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
    stage: import('../core/workflow').WorkflowStage
    /** Short-lived live progress shown while this application session is processing the work. */
    progressLabel?: string | null
    errorCode: string | null
  errorMessage: string | null
  retryable: boolean
  existingWorkId?: string
  likes: number
  relativePerformanceMultiplier: number | null
  reasons: HighlightReason[]
  radarStatus?: RadarStatus | null
  radarEvidence?: string[]
  firstBecameViralAt?: string | null
  canAnalyzeManually: boolean
}

export interface WorkDetail extends WorkListItem {
  originalUrl: string | null
  comments: number
  shares: number
  collects: number
  transcript: string | null
  analysis: AnalysisResult | null
  analysisProvider: string | null
  analyzedAt: string | null
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
  ownership?: WorkOwnership
}

export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface PublicSettings {
  providerId?: string
  modelId?: string
  customBaseUrl?: string
  apiKeyConfiguredByProvider?: Record<string, boolean>
  dailyTime?: string
  absoluteLikes?: number
  highCollects?: number
  highComments?: number
  highShares?: number
  relativePerformanceSurgeMultiplier?: number
  relativePerformanceMultiplier?: number
  /** Legacy setting retained only for one-time migration. */
  relativeViralIndex?: number
  analysisMaxWorksPerCreator?: number
  analysisRecentDays?: number
  mediaRetentionDays?: number
  feishuSyncRecentDays?: number
  feishuRetentionDays?: number
  feishuSyncMode?: FeishuSyncMode
  feishuConnected?: boolean
  douyinLoggedIn?: boolean
  /** Bumped when the application-owned Douyin browser profile changes. */
  douyinProfileVersion?: number
  /** Analysis engine used by 立即运行: cloud model API or local Codex CLI. */
  runEngine?: 'cloud' | 'local-agent'
  /**
   * Optional manual path/name of Codex CLI to use for local-agent runs.
   * When set, it overrides auto-detection. Lets users on other machines point
   * at a custom install location (e.g. D:\tools\codex.exe).
   */
  agentCliPath?: string
  /**
   * Optional model ID for local Codex runs. Passed through `codex exec --model`.
   */
  agentModel?: string
  /** Optional per-run Codex reasoning effort. Empty means Codex's current default. */
  agentReasoningEffort?: AgentReasoningEffort
}

export type SettingsInput = Partial<PublicSettings> & { apiKey?: string }

export interface DashboardHighlight {
  id: string
  creatorName: string
  title: string
  firstCapturedAt: string
  publishedAt: string
  likes: number
  comments: number
  shares: number
  collects: number
  relativePerformanceMultiplier: number | null
  reasons: HighlightReason[]
  radarStatus?: RadarStatus
  radarEvidence?: string[]
  firstBecameViralAt?: string | null
  originalUrl: string
  analysis: AnalysisResult | null
}

export interface WeeklyTopicRank {
  topic: string
  viralWorks: number
  totalLikes: number
  workIds: string[]
  newThisWeek?: number
  previousWeekNew?: number
  weekOverWeekDelta?: number
  representativeWorkId: string
  representativeTitle: string
}

export type DashboardState = 'pending' | 'running' | 'completed' | 'failed'

export interface DashboardRun {
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed'
  message: string
  requiresAction: boolean
  stages: Array<{ id: string; label: string; status: DashboardState }>
  failures?: RunFailure[]
}

export interface RunFailure {
  creatorId: string | null
  creatorName: string
  stage: 'discovery' | 'download' | 'transcription' | 'analysis' | 'feishu'
  code: string
  message: string
  occurredAt: string
}

export interface RunHistoryItem {
  id: string
  kind: 'daily' | 'manual' | 'catch_up'
  status: 'running' | 'completed' | 'failed' | 'partial'
  startedAt: string
  finishedAt: string | null
  discovered: number
  selectedForAnalysis: number
  analyzed: number
  failures: RunFailure[]
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
  creators: number
  newWorks: number
  analyzedWorks: number
  run: DashboardRun
  services: DashboardService[]
  weekly: {
    collectedWorks: number
    newViralWorks?: number
    warmingWorks?: number
    viralLikesGained?: number
    fastestGrowingWork?: {
      id: string
      title: string
      summary: string
      likesGained: number
      growthRatePercent: number
    } | null
    coveredCreators?: number
    viralWorks?: number
    viralRate?: number
    highestLikes?: number
    highestCreatorName?: string | null
    highestRelativePerformanceMultiplier?: number | null
  }
  today?: {
    newWorks: number
    newViralWorks: number
    warmingWorks: number
    coolingWorks: number
  }
  highlights: DashboardHighlight[]
  topicRanking: WeeklyTopicRank[]
  topicRankingState: 'ready' | 'insufficient' | 'unconfigured' | 'failed'
  topicRankingMessage: string
}
