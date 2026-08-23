export interface EngagementMetrics {
  likes: number
  comments: number
  shares: number
  collects: number
}

export interface Creator {
  id: string
  platform: 'douyin'
  name: string
  profileUrl: string
  enabled: boolean
  createdAt: string
  ownership?: WorkOwnership
}

export type WorkSourceType = 'douyin_monitor' | 'douyin_url' | 'local_file'
export type WorkOwnership = 'mine' | 'competitor'

export interface Work {
  id: string
  creatorId: string | null
  platformWorkId: string | null
  sourceType: WorkSourceType
  ownership: WorkOwnership
  sourceKey: string
  mediaPath: string | null
  title: string
  publishedAt: string
  originalUrl: string | null
  downloadUrl: string | null
  metrics: EngagementMetrics
}

export type { AnalysisResult as ContentAnalysis } from '../services/ai/analysis-schema'
