import { describe, expect, it, vi } from 'vitest'
import { ScraplingEngineRunner } from '../../src/services/scrapling-engine/runner'

const request = {
  command: 'capture_creator' as const,
  creatorId: 'creator-1',
  profileUrl: 'https://www.douyin.com/user/example',
  profileDirectory: 'C:\\Data\\browser'
}

describe('ScraplingEngineRunner', () => {
  it('sends the protocol version and accepts a valid response', async () => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: true,
      creator: { name: '林克AI实战录', profileUrl: request.profileUrl },
      works: [{
        id: '7659', title: '作品', publishedAt: '2026-07-15T00:00:00.000Z',
        originalUrl: 'https://www.douyin.com/video/7659',
        downloadUrl: 'https://v26-web.douyinvod.com/video.mp4',
        likes: 393, comments: 25, shares: 60, collects: 329
      }]
    }))
    const runner = new ScraplingEngineRunner({ invoke })

    const result = await runner.captureCreator('C:\\engine.exe', request)
    expect(JSON.parse(invoke.mock.calls[0][1])).toMatchObject({ protocolVersion: 1, command: 'capture_creator' })
    expect(result.works[0]).toMatchObject({ id: '7659', likes: 393 })
  })

  it.each([
    ['not-json', 'SCRAPLING_ENGINE_RESPONSE_INVALID'],
    [JSON.stringify({ protocolVersion: 2, ok: true, creator: {}, works: [] }), 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'],
    [JSON.stringify({ protocolVersion: 1, ok: true, creator: {}, works: [{ id: '../bad' }] }), 'SCRAPLING_ENGINE_RESPONSE_INVALID']
  ])('rejects an invalid response', async (output, code) => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(output) })
    await expect(runner.captureCreator('C:\\engine.exe', request)).rejects.toMatchObject({ code })
  })

  it('preserves a stable engine failure code', async () => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1, ok: false, error: { code: 'DOUYIN_RISK_CONTROL', message: '需要人工验证' }
    })) })
    await expect(runner.captureCreator('C:\\engine.exe', request)).rejects.toMatchObject({
      code: 'DOUYIN_RISK_CONTROL', retryable: false
    })
  })
})

