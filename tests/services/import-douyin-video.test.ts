import { describe, expect, it, vi } from 'vitest'
import { ImportError } from '../../src/services/import/import-errors'
import { extractWorkFromPayload } from '../../src/services/douyin/discovery'
import {
  normalizeDouyinVideoUrl,
  resolveDouyinVideo,
  type ShortLinkResolver
} from '../../src/services/import/douyin-video-source'
import type { PublicDouyinVideo } from '../../src/services/douyin/public-share-resolver'
import { resolvePublicDouyinVideo } from '../../src/services/douyin/public-share-resolver'

const noPublicResult = vi.fn(async (): Promise<PublicDouyinVideo | null> => null)

describe('Douyin video URL import', () => {
  it('opens the browser once after every public endpoint body stream fails', async () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const contentType of [
      'text/html', 'text/html',
      'application/json', 'application/json',
      'text/html', 'text/html',
      'application/json', 'application/json'
    ]) {
      fetcher.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new Error('stream interrupted')) }
      }), { headers: { 'content-type': contentType } }))
    }
    const captureSingleVideo = vi.fn().mockResolvedValue({
      title: '浏览器文案',
      downloadUrl: 'https://media.example.com/browser.mp4'
    })

    await expect(resolveDouyinVideo(
      'https://www.douyin.com/video/7658',
      { captureSingleVideo },
      fetch,
      (videoId) => resolvePublicDouyinVideo(videoId, { fetcher, retryDelayMs: 0 })
    )).resolves.toMatchObject({ title: '浏览器文案' })
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(captureSingleVideo).toHaveBeenCalledOnce()
  })
  it('uses public media without opening the browser', async () => {
    const captureSingleVideo = vi.fn()
    const resolvePublic = vi.fn().mockResolvedValue({
      videoId: '7658', title: '公开文案', downloadUrl: 'https://media.example.com/7658.mp4',
      authorName: '作者', likes: 10, comments: 2, shares: 1, coverUrl: null, source: 'detail_api'
    })

    await expect(resolveDouyinVideo(
      'https://www.douyin.com/video/7658',
      { captureSingleVideo },
      fetch,
      resolvePublic
    )).resolves.toMatchObject({ title: '公开文案', downloadUrl: 'https://media.example.com/7658.mp4' })
    expect(captureSingleVideo).not.toHaveBeenCalled()
  })

  it('preserves public metadata while using one browser capture to fill missing media', async () => {
    const captureSingleVideo = vi.fn().mockResolvedValue({ title: '浏览器文案', downloadUrl: 'https://media.example.com/captured.mp4' })
    const resolvePublic = vi.fn().mockResolvedValue({
      videoId: '7658', title: '公开文案', downloadUrl: null,
      authorName: '作者', likes: 10, comments: 2, shares: 1, coverUrl: null, source: 'share_router'
    })

    await expect(resolveDouyinVideo(
      'https://www.douyin.com/user/self?modal_id=7658',
      { captureSingleVideo },
      fetch,
      resolvePublic
    )).resolves.toMatchObject({ title: '公开文案', downloadUrl: 'https://media.example.com/captured.mp4' })
    expect(captureSingleVideo).toHaveBeenCalledOnce()
    expect(captureSingleVideo).toHaveBeenCalledWith('7658', 'https://www.douyin.com/video/7658')
  })

  it('keeps the existing upload-local error after public metadata and browser media both fail', async () => {
    const captureSingleVideo = vi.fn().mockResolvedValue({ title: '浏览器文案', downloadUrl: null })
    const resolvePublic = vi.fn().mockResolvedValue({
      videoId: '7658', title: '公开文案', downloadUrl: null,
      authorName: '作者', likes: 10, comments: 2, shares: 1, coverUrl: null, source: 'share_router'
    })

    const error = await captureError(resolveDouyinVideo(
      'https://www.douyin.com/video/7658',
      { captureSingleVideo },
      fetch,
      resolvePublic
    ))
    expect(error).toMatchObject({ code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', action: 'upload_local' })
    expect(error.partialSource).toEqual({
      sourceKey: 'douyin:7658',
      title: '公开文案',
      originalUrl: 'https://www.douyin.com/video/7658'
    })
    expect(captureSingleVideo).toHaveBeenCalledOnce()
  })
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

  it('normalizes a work opened from a creator modal', () => {
    expect(normalizeDouyinVideoUrl(
      'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7659607768617307402'
    )).toEqual({
      videoId: '7659607768617307402',
      canonicalUrl: 'https://www.douyin.com/video/7659607768617307402'
    })
  })

  it.each([
    'https://www.douyin.com/user/self',
    'https://www.douyin.com/user/self?modal_id=',
    'https://www.douyin.com/user/self?modal_id=abc',
    'https://www.douyin.com/user/self?modal_id=123&modal_id=456',
    'https://www.douyin.com/user/self?modal_id=123&modal_id=123',
    'https://evil.example/user/self?modal_id=123',
    'https://name:secret@www.douyin.com/user/self?modal_id=123',
    'https://www.douyin.com:444/user/self?modal_id=123',
    'https://www.douyin.com/user/self/extra?modal_id=123',
    'https://www.douyin.com/user/?modal_id=123'
  ])('rejects non-work modal input %s', (input) => {
    expect(() => normalizeDouyinVideoUrl(input)).toThrow('INVALID_DOUYIN_VIDEO_URL')
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

    await expect(resolveDouyinVideo('https://v.douyin.com/AbC12/', { captureSingleVideo: capture }, resolver, noPublicResult)).resolves.toEqual({
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

    await expect(resolveDouyinVideo('https://v.douyin.com/First', capture, resolver, noPublicResult)).resolves.toMatchObject({ sourceKey: 'douyin:9' })
    expect(resolver).toHaveBeenCalledTimes(2)
    for (const [, init] of resolver.mock.calls) expect(init.credentials).toBe('omit')
  })

  it('rejects a 200 response even when it has a Location header', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const resolver = vi.fn<ShortLinkResolver>().mockResolvedValueOnce(responseWithBody(200, 'https://www.douyin.com/video/9', cancel))

    const error = await captureError(resolveDouyinVideo('https://v.douyin.com/A', { captureSingleVideo: vi.fn() }, resolver))

    expect((error.cause as Error).message).toBe('DOUYIN_SHORT_URL_STATUS_INVALID')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels every redirect response body before returning the resolved URL', async () => {
    const firstCancel = vi.fn().mockResolvedValue(undefined)
    const finalCancel = vi.fn().mockResolvedValue(undefined)
    const resolver = vi.fn<ShortLinkResolver>()
      .mockResolvedValueOnce(responseWithBody(302, '/Next', firstCancel))
      .mockResolvedValueOnce(responseWithBody(301, 'https://www.douyin.com/video/9', finalCancel))
    const capture = { captureSingleVideo: vi.fn().mockResolvedValue({ title: 'nine', downloadUrl: 'https://media.test/9' }) }

    await resolveDouyinVideo('https://v.douyin.com/A', capture, resolver, noPublicResult)

    expect(firstCancel).toHaveBeenCalledOnce()
    expect(finalCancel).toHaveBeenCalledOnce()
  })

  it('cancels a response body on validation failure without masking the primary error', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'))
    const resolver = vi.fn<ShortLinkResolver>().mockResolvedValueOnce(responseWithBody(302, null, cancel))

    const error = await captureError(resolveDouyinVideo('https://v.douyin.com/A', { captureSingleVideo: vi.fn() }, resolver))

    expect((error.cause as Error).message).toBe('DOUYIN_SHORT_URL_LOCATION_MISSING')
    expect(cancel).toHaveBeenCalledOnce()
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
    const error = await captureError(resolveDouyinVideo(
      'https://www.douyin.com/video/7658',
      { captureSingleVideo },
      fetch,
      noPublicResult
    ))

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

function responseWithBody(status: number, location: string | null, cancel: ReturnType<typeof vi.fn>): Response {
  return {
    status,
    headers: new Headers(location ? { location } : {}),
    body: { cancel }
  } as unknown as Response
}
