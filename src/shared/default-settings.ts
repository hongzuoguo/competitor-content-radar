import type { PublicSettings } from './ipc-contract'

export const RECOMMENDED_BEHAVIOR_SETTINGS = {
  analysisRecentDays: 30,
  analysisMaxWorksPerCreator: 10,
  mediaRetentionDays: 7,
  feishuSyncRecentDays: 30,
  feishuRetentionDays: 30,
  feishuSyncMode: 'auto',
  absoluteLikes: 10_000,
  relativePerformanceMultiplier: 3,
  relativePerformanceSurgeMultiplier: 80,
  highCollects: 3_000,
  highComments: 500,
  highShares: 500
} as const satisfies Partial<PublicSettings>

export const RECOMMENDED_CLEAR_KEYS = [
  'agentModel',
  'agentReasoningEffort'
] as const satisfies readonly (keyof PublicSettings)[]
