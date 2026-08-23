import { describe, expect, it } from 'vitest'
import {
  calculateEngagement,
  calculateRelativePerformance,
  evaluateHighlight
} from '../../src/core/highlight-rules'

const metrics = (likes: number, comments = 0, shares = 0, collects = 0) => ({
  likes,
  comments,
  shares,
  collects
})

describe('highlight rules', () => {
  it('sums all confirmed engagement dimensions', () => {
    expect(calculateEngagement(metrics(100, 20, 5, 8))).toBe(133)
  })

  it('marks a work with at least 10,000 likes as absolute high likes', () => {
    expect(evaluateHighlight(metrics(10_000), []).reasons).toContain('absolute_high_likes')
  })

  it('marks a work with at least 3,000 collects as high collects', () => {
    expect(evaluateHighlight(metrics(0, 0, 0, 3_000), []).reasons).toContain('high_collects')
  })

  it('marks a work with at least 500 comments as high comments', () => {
    expect(evaluateHighlight(metrics(0, 500), []).reasons).toContain('high_comments')
  })

  it('marks a work with at least 500 shares as high shares', () => {
    expect(evaluateHighlight(metrics(0, 0, 500), []).reasons).toContain('high_shares')
  })

  it('requires at least five baseline works for relative performance', () => {
    expect(calculateRelativePerformance(metrics(300), [100, 100, 100, 100])).toBeNull()
  })

  it('returns null when the historical median is zero', () => {
    expect(calculateRelativePerformance(metrics(300), [0, 0, 0, 0, 0])).toBeNull()
  })

  it('uses the median of up to 30 historical works', () => {
    const baseline = [100, 100, 200, 300, 10_000]
    expect(calculateRelativePerformance(metrics(300), baseline)).toBe(1.5)
  })

  it('marks relative performance surge at 80x of the historical median', () => {
    const baseline = [100, 100, 100, 100, 100]
    const result = evaluateHighlight(metrics(8_000), baseline)
    expect(result.reasons).toContain('relative_performance_surge')
    expect(result.isHighlight).toBe(true)
  })

  it('marks relative performance at 3x of the historical median with at least 100 likes', () => {
    const baseline = [100, 100, 100, 100, 100]
    const result = evaluateHighlight(metrics(300), baseline)
    expect(result.reasons).toEqual(['relative_performance'])
    expect(result.isHighlight).toBe(true)
  })

  it('does not mark relative performance below 3x or below 100 likes', () => {
    const belowMultiplier = evaluateHighlight(metrics(200), [100, 100, 100, 100, 100])
    expect(belowMultiplier.reasons).not.toContain('relative_performance')

    const belowLikes = evaluateHighlight(metrics(300), [100, 100, 100, 100, 100], { minimumRelativeLikes: 400 })
    expect(belowLikes.reasons).not.toContain('relative_performance')
  })
})
