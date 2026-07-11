import { describe, expect, it } from 'vitest'
import {
  deduplicateWorks,
  normalizeCreatorUrl,
  normalizeDouyinWork,
  selectBaselineWorks,
  selectRecentWorks
} from '../../src/services/douyin/normalizers'

describe('Douyin metadata normalization', () => {
  it('removes query parameters and accepts creator profile URLs only', () => {
    expect(
      normalizeCreatorUrl(
        'https://www.douyin.com/user/MS4w.example?from_tab_name=main&vid=7658'
      )
    ).toBe('https://www.douyin.com/user/MS4w.example')
    expect(() => normalizeCreatorUrl('https://www.douyin.com/video/7658')).toThrow(
      'INVALID_DOUYIN_CREATOR_URL'
    )
  })

  it('normalizes public work fields without inventing play count', () => {
    const work = normalizeDouyinWork('creator-1', {
      aweme_id: '7658',
      desc: '测试作品',
      create_time: 1_783_724_400,
      statistics: {
        digg_count: 10_000,
        comment_count: 100,
        share_count: 20,
        collect_count: 30
      },
      video: { play_addr: { url_list: ['https://video.example.test/7658.mp4'] } }
    })

    expect(work.platformWorkId).toBe('7658')
    expect(work.metrics).toEqual({ likes: 10_000, comments: 100, shares: 20, collects: 30 })
    expect(work.downloadUrl).toBe('https://video.example.test/7658.mp4')
    expect(work).not.toHaveProperty('playCount')
  })

  it('keeps the newest 30 baseline works and only 120-hour recent works', () => {
    const works = Array.from({ length: 35 }, (_, index) => ({
      id: `work-${index}`,
      creatorId: 'creator-1',
      platformWorkId: String(index),
      sourceType: 'douyin_monitor' as const,
      sourceKey: `douyin:${index}`,
      mediaPath: null,
      title: `作品 ${index}`,
      publishedAt: new Date(Date.UTC(2026, 6, 11) - index * 24 * 60 * 60 * 1000).toISOString(),
      originalUrl: `https://www.douyin.com/video/${index}`,
      downloadUrl: null,
      metrics: { likes: index, comments: 0, shares: 0, collects: 0 }
    }))

    expect(selectBaselineWorks(works)).toHaveLength(30)
    expect(selectRecentWorks(works, new Date('2026-07-11T00:00:00.000Z'))).toHaveLength(6)
  })

  it('deduplicates captured responses by platform work ID', () => {
    const first = normalizeDouyinWork('creator-1', { aweme_id: '1', desc: '旧标题' })
    const second = { ...first, title: '新标题' }
    expect(deduplicateWorks([first, second])).toEqual([second])
  })

  it('deduplicates by source type and source key together', () => {
    const monitored = normalizeDouyinWork('creator-1', { aweme_id: '1' })
    const urlImport = { ...monitored, id: 'url:1', sourceType: 'douyin_url' as const }
    const updatedImport = { ...urlImport, title: 'Updated import' }

    expect(deduplicateWorks([monitored, urlImport, updatedImport])).toEqual([
      monitored,
      updatedImport
    ])
  })
})
