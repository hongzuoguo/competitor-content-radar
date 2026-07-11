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

export interface ContentAnalysis {
  topicAngle: string
  openingHook: string
  structure: string[]
  viralPoints: string[]
  interactionGuidance: string
  highlights: string[]
  reusablePatterns: string[]
  differentiatedSuggestions: string[]
  referenceValueScore: number
  referenceValueReason: string
}
