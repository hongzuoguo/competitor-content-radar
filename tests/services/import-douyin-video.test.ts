import { describe, expect, it, vi } from 'vitest'
import { ImportError } from '../../src/services/import/import-errors'
import { extractWorkFromPayload } from '../../src/services/douyin/discovery'
import {
  normalizeDouyinVideoUrl,
  resolveDouyinVideo,
  type ShortLinkResolver
} from '../../src/services/import/douyin-video-source'

describe('Douyin video URL import', () => {
  it('extracts the target work from a single-video payload', () => {
    const work = extractWorkFromPayload('7658', {
      data: { aweme_detail: { aweme_id: '7658', desc: '示例', video: { play_addr: { url_list: ['https://media.test/7658'] } } } }
    })
    expect(work).toMatchObject({ platformWorkId: '7658', title: '示例', downloadUrl: 'https://media.test/7658' })
  })

  it('canonicalizes a direct video URL and extracts its numeric id', () => {
    expect(normalizeDouyinVideoUrl(' https://douyin.com/video/7658/?from=share#clip ')).toEqual({
      videoId: '7658',
      canonicalUrl: 'https://www.douyin.com/video/7658'
    })
  })

  it.each([
    'http://www.douyin.com/video/7658',
    'https://example.com/video/7658',
    'https://www.douyin.com:444/video/7658',
    'https://name:secret@www.douyin.com/video/7658',
    'https://www.douyin.com/user/7658',
    'https://www.douyin.com/video/not-digits',
    'https://www.douyin.com/video/'
  ])('rejects invalid direct video URL %s', (input) => {
    expect(() => normalizeDouyinVideoUrl(input)).toThrow('INVALID_DOUYIN_VIDEO_URL')
  })

  it('resolves a short link manually and returns a stable descriptor', async () => {
    const resolver = vi.fn<ShortLinkResolver>().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://www.douyin.com/video/7658?share=1' } })
    )
    const capture = vi.fn().mockResolvedValue({ title: '示例视频', downloadUrl: 'https://media.test/video.mp4' })

    await expect(resolveDouyinVideo('https://v.douyin.com/AbC12/', { captureSingleVideo: capture }, resolver)).resolves.toEqual({
      sourceType: 'douyin_url',
      sourceKey: 'douyin:7658',
      title: '示例视频',
      originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: 'https://media.test/video.mp4'
    })
    expect(resolver).toHaveBeenCalledWith('https://v.douyin.com/AbC12/', expect.objectContaining({ redirect: 'manual' }))
    expect(capture).toHaveBeenCalledWith('7658', 'https://www.douyin.com/video/7658')
  })

  it('permits only v.douyin.com on intermediate redirects', async () => {
    const resolver = vi.fn<ShortLinkResolver>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/Next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.douyin.com/video/9' } }))
    const capture = { captureSingleVideo: vi.fn().mockResolvedValue({ title: '九', downloadUrl: 'https://media.test/9' }) }

    await expect(resolveDouyinVideo('https://v.douyin.com/First', capture, resolver)).resolves.toMatchObject({ sourceKey: 'douyin:9' })
    expect(resolver).toHaveBeenCalledTimes(2)
    for (const [, init] of resolver.mock.calls) expect(init.credentials).toBe('omit')
  })

  it.each([
    ['external redirect', ['https://evil.test/video/1']],
    ['profile redirect', ['https://www.douyin.com/user/abc']],
    ['missing Location', [null]],
    ['redirect loop', ['https://v.douyin.com/A', 'https://v.douyin.com/A']],
    ['too many redirects', [
      'https://v.douyin.com/2', 'https://v.douyin.com/3', 'https://v.douyin.com/4',
      'https://v.douyin.com/5', 'https://v.douyin.com/6', 'https://www.douyin.com/video/7'
    ]]
  ])('rejects a short link with %s', async (_name, locations) => {
    const resolver = vi.fn<ShortLinkResolver>()
    for (const location of locations as Array<string | null>) {
      resolver.mockResolvedValueOnce(new Response(null, { status: 302, headers: location ? { location } : {} }))
    }
    await expect(resolveDouyinVideo('https://v.douyin.com/A', { captureSingleVideo: vi.fn() }, resolver)).rejects.toThrow(ImportError)
  })

  it.each([
    ['no result', null],
    ['no download URL', { title: '视频', downloadUrl: null }],
    ['risk control', new Error('cookie=secret internal=https://private.test')],
    ['timeout', Object.assign(new Error('timed out'), { code: 'DOUYIN_LOAD_TIMEOUT' })]
  ])('maps capture %s to a safe upload-local error', async (_name, outcome) => {
    const captureSingleVideo = outcome instanceof Error
      ? vi.fn().mockRejectedValue(outcome)
      : vi.fn().mockResolvedValue(outcome)
    const error = await captureError(resolveDouyinVideo('https://www.douyin.com/video/7658', { captureSingleVideo }))

    expect(error.code).toBe('DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE')
    expect(error.action).toBe('upload_local')
    expect(error.message).toMatch(/[\u4e00-\u9fff]/)
    expect(error.message).not.toContain('secret')
    expect(error.message).not.toContain('private.test')
  })
})

async function captureError(promise: Promise<unknown>): Promise<ImportError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    return error as ImportError
  }
  throw new Error('Expected an ImportError')
}
