import { describe, expect, it, vi } from 'vitest'
import { ScraplingFallbackCollector } from '../../src/services/scrapling-engine/fallback-collector'

const fallbackResult = {
  protocolVersion: 1 as const, ok: true as const,
  creator: { name: '林克AI实战录', profileUrl: 'https://www.douyin.com/user/example' },
  works: [{
    id: '7659', title: '作品', publishedAt: '2026-07-15T00:00:00.000Z',
    originalUrl: 'https://www.douyin.com/video/7659', downloadUrl: 'https://video.example/test.mp4',
    likes: 393, comments: 25, shares: 60, collects: 329
  }]
}

function setup(primaryResult: unknown[] | Error) {
  const primary = primaryResult instanceof Error
    ? vi.fn().mockRejectedValue(primaryResult)
    : vi.fn().mockResolvedValue(primaryResult)
  const manager = { ensureInstalled: vi.fn().mockResolvedValue('C:\\engine.exe') }
  const runner = { captureCreator: vi.fn().mockResolvedValue(fallbackResult) }
  return { primary, manager, runner }
}

describe('ScraplingFallbackCollector', () => {
  it('does not install the engine when primary capture succeeds', async () => {
    const existing = [{ id: 'existing' }]
    const deps = setup(existing)
    const collector = new ScraplingFallbackCollector(deps.manager, deps.runner, 'C:\\profile')
    await expect(collector.capture('creator-1', 'https://www.douyin.com/user/example', deps.primary)).resolves.toBe(existing)
    expect(deps.manager.ensureInstalled).not.toHaveBeenCalled()
  })

  it('installs and uses the engine when primary capture is empty', async () => {
    const deps = setup([])
    const collector = new ScraplingFallbackCollector(deps.manager, deps.runner, 'C:\\profile')
    const works = await collector.capture('creator-1', 'https://www.douyin.com/user/example', deps.primary)
    expect(works[0]).toMatchObject({ id: 'douyin:7659', creatorId: 'creator-1', metrics: { likes: 393 } })
  })

  it('uses fallback after a retryable primary failure', async () => {
    const deps = setup(Object.assign(new Error('load timeout'), { code: 'DOUYIN_LOAD_TIMEOUT', retryable: true }))
    const collector = new ScraplingFallbackCollector(deps.manager, deps.runner, 'C:\\profile')
    await expect(collector.capture('creator-1', 'https://www.douyin.com/user/example', deps.primary)).resolves.toHaveLength(1)
  })

  it('uses the independent public-page engine once after primary risk control', async () => {
    const error = Object.assign(new Error('risk'), { code: 'DOUYIN_RISK_CONTROL', retryable: false })
    const deps = setup(error)
    const collector = new ScraplingFallbackCollector(deps.manager, deps.runner, 'C:\\profile')
    await expect(collector.capture('creator-1', 'https://www.douyin.com/user/example', deps.primary)).resolves.toHaveLength(1)
    expect(deps.manager.ensureInstalled).toHaveBeenCalledTimes(1)
    expect(deps.runner.captureCreator).toHaveBeenCalledTimes(1)
  })

  it('propagates fallback risk control without retrying', async () => {
    const deps = setup(Object.assign(new Error('primary risk'), { code: 'DOUYIN_RISK_CONTROL', retryable: false }))
    deps.runner.captureCreator.mockRejectedValue(Object.assign(new Error('fallback risk'), {
      code: 'DOUYIN_RISK_CONTROL', retryable: false
    }))
    const collector = new ScraplingFallbackCollector(deps.manager, deps.runner, 'C:\\profile')
    await expect(collector.capture('creator-1', 'https://www.douyin.com/user/example', deps.primary))
      .rejects.toMatchObject({ code: 'DOUYIN_RISK_CONTROL' })
    expect(deps.runner.captureCreator).toHaveBeenCalledTimes(1)
  })
})
