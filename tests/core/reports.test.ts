import { describe, expect, it } from 'vitest'
import { buildReportSummary } from '../../src/core/reports'

describe('report aggregation', () => {
  it('summarizes works, engagement and highlights without fabricating play count', () => {
    const report = buildReportSummary([
      {
        likes: 10_000,
        comments: 100,
        shares: 20,
        collects: 30,
        highlightReasons: ['absolute_high_likes']
      },
      {
        likes: 500,
        comments: 20,
        shares: 10,
        collects: 5,
        highlightReasons: []
      }
    ])

    expect(report).toEqual({
      works: 2,
      highlights: 1,
      likes: 10_500,
      comments: 120,
      shares: 30,
      collects: 35,
      engagement: 10_685
    })
    expect(report).not.toHaveProperty('playCount')
  })
})
