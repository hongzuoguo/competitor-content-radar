import { describe, expect, it } from 'vitest'
import {
  calculateEngagement,
  calculateRelativeViralIndex,
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
    expect(evaluateHighlight(metrics(10_000), [], null).reasons).toContain('absolute_high_likes')
  })

  it('requires at least five baseline works for a relative index', () => {
    expect(calculateRelativeViralIndex(metrics(300), [100, 100, 100, 100])).toBeNull()
  })

  it('returns null when the historical median is zero', () => {
    expect(calculateRelativeViralIndex(metrics(300), [0, 0, 0, 0, 0])).toBeNull()
  })

  it('uses the median of up to 30 historical works', () => {
    const baseline = [100, 100, 200, 300, 10_000]
    expect(calculateRelativeViralIndex(metrics(300), baseline)).toBe(150)
  })

  it('marks relative viral and high reference value independently', () => {
    const result = evaluateHighlight(metrics(300), [100, 100, 200, 300, 10_000], 80)
    expect(result.reasons).toEqual(['relative_viral', 'high_reference_value'])
    expect(result.isHighlight).toBe(true)
  })
})
