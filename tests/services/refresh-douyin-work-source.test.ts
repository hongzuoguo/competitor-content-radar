import { describe, expect, it, vi } from 'vitest'
import type { Work } from '../../src/core/domain'
import { refreshDouyinWorkSource } from '../../src/services/douyin/refresh-work-source'

const monitoredWork: Work = {
  id: 'douyin:7647063610389038693',
  creatorId: 'creator-1',
  platformWorkId: '7647063610389038693',
  sourceType: 'douyin_monitor',
  ownership: 'competitor',
  sourceKey: 'douyin:7647063610389038693',
  mediaPath: null,
  title: '旧标题',
  publishedAt: '2026-06-03T00:00:00.000Z',
  originalUrl: 'https://www.douyin.com/video/7647063610389038693',
  downloadUrl: 'https://expired.example.com/video.mp4',
  metrics: { likes: 298, comments: 17, shares: 63, collects: 131 }
}

describe('refreshDouyinWorkSource', () => {
  it('refreshes a monitored Douyin work with a newly captured media URL', async () => {
    const captureSingleVideo = vi.fn().mockResolvedValue({
      title: '最新标题',
      downloadUrl: 'https://v3-web.douyinvod.com/fresh.mp4'
    })

    await expect(refreshDouyinWorkSource(monitoredWork, { captureSingleVideo })).resolves.toMatchObject({
      title: '最新标题',
      downloadUrl: 'https://v3-web.douyinvod.com/fresh.mp4'
    })
    expect(captureSingleVideo).toHaveBeenCalledWith(
      '7647063610389038693',
      'https://www.douyin.com/video/7647063610389038693'
    )
  })
})
