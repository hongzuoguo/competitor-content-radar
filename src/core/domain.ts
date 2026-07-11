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
}

export interface Work {
  id: string
  creatorId: string
  platformWorkId: string
  title: string
  publishedAt: string
  originalUrl: string
  metrics: EngagementMetrics
}

export type { AnalysisResult as ContentAnalysis } from '../services/ai/analysis-schema'
