export interface CreatorRow {
  id: string
  name: string
  profileUrl: string
  enabled: boolean
  works: number
  lastRun: string
  status: 'ready' | 'waiting' | 'attention'
}
