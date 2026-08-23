import { describe, expect, it } from 'vitest'
import type { DashboardHighlight } from '../../src/shared/ipc-contract'
import { sortHighlights, type HighlightSortMode } from '../../src/renderer/src/features/overview/highlight-sorting'

function highlight(id: string, overrides: Partial<DashboardHighlight> = {}): DashboardHighlight {
  return {
    id,
    creatorName: `creator-${id}`,
    title: id,
    firstCapturedAt: '2026-08-13T00:00:00.000Z',
    publishedAt: '2026-08-13T00:00:00.000Z',
    likes: 100,
    comments: 0,
    shares: 0,
    collects: 0,
    relativePerformanceMultiplier: null,
    radarStatus: undefined,
    radarEvidence: [],
    firstBecameViralAt: null,
    reasons: ['absolute_high_likes'],
    analysis: null,
    originalUrl: `https://www.douyin.com/video/${id}`,
    ...overrides
  }
}

describe('highlight sorting', () => {
  it('orders heat by radar state, likes and original index without mutating input', () => {
    const input = [
      highlight('cooling', { radarStatus: 'cooling', likes: 900 }),
      highlight('new-low', { radarStatus: 'newly_viral', likes: 200 }),
      highlight('strong', { radarStatus: 'strong', likes: 800 }),
      highlight('new-high', { radarStatus: 'newly_viral', likes: 500 }),
      highlight('warming', { radarStatus: 'warming', likes: 100 }),
      highlight('watching', { radarStatus: 'watching', likes: 1000 }),
      highlight('none', { radarStatus: undefined, likes: 2000 }),
      highlight('stable-a', { radarStatus: 'strong', likes: 300 }),
      highlight('stable-b', { radarStatus: 'strong', likes: 300 })
    ]
    const snapshot = [...input]

    expect(sortHighlights(input, 'heat').map((item) => item.id)).toEqual([
      'new-high', 'new-low', 'warming', 'strong', 'stable-a', 'stable-b', 'watching', 'cooling', 'none'
    ])
    expect(input).toEqual(snapshot)
  })

  it('orders performance by multiplier, puts null last, then likes and original index', () => {
    const input = [
      highlight('null-high', { relativePerformanceMultiplier: null, likes: 9999 }),
      highlight('three-low', { relativePerformanceMultiplier: 3, likes: 100 }),
      highlight('four', { relativePerformanceMultiplier: 4, likes: 1 }),
      highlight('three-high-a', { relativePerformanceMultiplier: 3, likes: 500 }),
      highlight('three-high-b', { relativePerformanceMultiplier: 3, likes: 500 }),
      highlight('null-low', { relativePerformanceMultiplier: null, likes: 1 })
    ]

    expect(sortHighlights(input, 'performance').map((item) => item.id)).toEqual([
      'four', 'three-high-a', 'three-high-b', 'three-low', 'null-high', 'null-low'
    ])
  })

  it.each<HighlightSortMode>(['heat', 'performance'])('returns a new array for %s mode', (mode) => {
    const input = [highlight('one')]
    expect(sortHighlights(input, mode)).not.toBe(input)
  })
})
