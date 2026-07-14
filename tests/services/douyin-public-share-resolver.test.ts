import { describe, expect, it, vi } from 'vitest'
import {
  DouyinRiskControlError,
  resolvePublicDouyinVideo
} from '../../src/services/douyin/public-share-resolver'

const ID = '7659607768617307402'

function routerHtml(aweme: Record<string, unknown>): string {
  return `<html><script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [aweme] } } } })};</script></html>`
}

function response(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8')
  return new Response(body, { status: 200, ...init, headers })
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers }
  })
}

function video(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aweme_id: ID,
    desc: '测试作品',
    author: { nickname: '测试作者' },
    statistics: { digg_count: 12, comment_count: 3, share_count: 4 },
    video: {
      play_addr: { url_list: ['https://media.example.com/aweme/v1/playwm/?video_id=abc&watermark=1'] },
      cover: { url_list: ['https://p.example.com/cover.jpeg'] }
    },
    ...overrides
  }
}

describe('Douyin public share resolver', () => {
  it.each([
    [
      'detail_api',
      [response('<html>missing</html>'), jsonResponse({ aweme_detail: video() })],
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${ID}&aid=6383`
    ],
    [
      'share_page',
      [response('<html>missing</html>'), jsonResponse({}), response(routerHtml(video()))],
      `https://www.douyin.com/share/video/${ID}`
    ],
    [
      'iteminfo_api',
      [response('<html>missing</html>'), jsonResponse({}), response('<html>missing</html>'), jsonResponse({ item_list: [video()] })],
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${ID}`
    ]
  ])('falls back serially to %s and reports its source', async (source, responses, finalUrl) => {
    const fetcher = vi.fn<typeof fetch>()
    for (const result of responses as Response[]) fetcher.mockResolvedValueOnce(result)

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({
      videoId: ID,
      source
    })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual((responses as Response[]).map((_response, index) => [
      `https://www.iesdouyin.com/share/video/${ID}`,
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${ID}&aid=6383`,
      `https://www.douyin.com/share/video/${ID}`,
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${ID}`
    ][index]))
    expect(fetcher).toHaveBeenLastCalledWith(finalUrl, expect.any(Object))
  })

  it('ignores a mismatched detail response and stops after the next matching endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('<html>missing</html>'))
      .mockResolvedValueOnce(jsonResponse({ aweme_detail: video({ aweme_id: '999' }) }))
      .mockResolvedValueOnce(response(routerHtml(video())))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ source: 'share_page' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('stops the endpoint chain immediately when a fallback response is risk controlled', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('<html>missing</html>'))
      .mockResolvedValueOnce(jsonResponse({ message: '访问过于频繁，请完成安全验证' }))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).rejects.toBeInstanceOf(DouyinRiskControlError)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('requires JSON content type for API responses and enforces the body limit', async () => {
    const wrongType = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('<html>missing</html>'))
      .mockResolvedValueOnce(response(JSON.stringify({ aweme_detail: video() })))
      .mockResolvedValueOnce(response(routerHtml(video())))
    await expect(resolvePublicDouyinVideo(ID, { fetcher: wrongType })).resolves.toMatchObject({ source: 'share_page' })

    const tooLarge = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('<html>missing</html>'))
      .mockResolvedValueOnce(jsonResponse({}, { headers: { 'content-length': '101', 'content-type': 'application/json' } }))
    await expect(resolvePublicDouyinVideo(ID, { fetcher: tooLarge, maxBodyBytes: 100 })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE'
    })
  })

  it('parses a video from window._ROUTER_DATA and sends a constrained request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(routerHtml(video())))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toEqual({
      videoId: ID,
      title: '测试作品',
      downloadUrl: 'https://media.example.com/aweme/v1/play/?video_id=abc&watermark=1',
      authorName: '测试作者',
      likes: 12,
      comments: 3,
      shares: 4,
      coverUrl: 'https://p.example.com/cover.jpeg',
      source: 'share_router'
    })
    expect(fetcher).toHaveBeenCalledWith(
      `https://www.iesdouyin.com/share/video/${ID}`,
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ 'user-agent': expect.stringMatching(/Mobile/i) })
      })
    )
  })

  it('supports note loader and camelCase field variants without media', async () => {
    const payload = {
      loaderData: {
        'note_(id)/page': {
          itemInfo: {
            awemeId: ID,
            title: '图文作品',
            author: { nickname: '图文作者' },
            statistics: { like_count: '8', comment_count: 0, share_count: 2 },
            images: [{ urlList: ['https://p.example.com/note-cover.jpeg'] }]
          }
        }
      }
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(`<script>window._ROUTER_DATA=${JSON.stringify(payload)}</script>`)
    )

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toEqual({
      videoId: ID,
      title: '图文作品',
      downloadUrl: null,
      authorName: '图文作者',
      likes: 8,
      comments: 0,
      shares: 2,
      coverUrl: 'https://p.example.com/note-cover.jpeg',
      source: 'share_router'
    })
  })

  it('returns null for missing router data, invalid JSON, and mismatched work IDs', async () => {
    for (const body of [
      '<html>no data</html>',
      '<script>window._ROUTER_DATA={broken}</script>',
      routerHtml(video({ aweme_id: '999' }))
    ]) {
      await expect(resolvePublicDouyinVideo(ID, {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(body))
      })).resolves.toBeNull()
    }
  })

  it('ignores documentation text that mentions the router marker before an unrelated object', async () => {
    const body = [
      '<script>const documentation = "window._ROUTER_DATA is assigned by the page";</script>',
      `<script>const unrelated = ${JSON.stringify({ loaderData: { 'video_(id)/page': { item: video() } } })}</script>`
    ].join('')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('ignores router assignments inside JavaScript comments', async () => {
    const assignment = `window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}`
    const body = `<script>// ${assignment}\nconst ready = true;</script><script>/* ${assignment} */</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('does not accept the marker as a suffix of another identifier', async () => {
    const body = `<script>mywindow._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it.each(["'", '"'])('does not treat script attribute text after > as script code (%s quote)', async (quote) => {
    const assignment = `window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}`
    const body = `<script data-doc=${quote}>${assignment}${quote}></script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('still parses a real assignment after quoted script attributes', async () => {
    const body = `<script data-doc="> is attribute text"> window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it('keeps script offsets stable after Unicode text with expanding case folds', async () => {
    const body = `İ<script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it('treats a backslash before the closing HTML attribute quote as ordinary text', async () => {
    const body = `<script data-doc="\\">window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it('continues to a later script after an attribute ending with backslash text', async () => {
    const body = [
      `<script data-doc="\\">const ignored = true;</script>`,
      `<script>window._ROUTER_DATA = ${JSON.stringify({
        loaderData: { 'video_(id)/page': { item: video() } }
      })}</script>`
    ].join('')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it.each([
    (assignment: string) => `<!-- <script>${assignment}</script> -->`,
    (assignment: string) => `<textarea><script>${assignment}</script></textarea>`,
    (assignment: string) => `<div data-doc="<script>${assignment}</script>">attribute only</div>`
  ])('ignores script-looking text outside a real script element %#', async (render) => {
    const assignment = `window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(render(assignment)))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('returns null for malformed HTML instead of throwing', async () => {
    const body = `<script data-doc="unterminated>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('accepts a whitespace-delimited assignment in a later script', async () => {
    const body = `<script>const first = {};</script><script>window._ROUTER_DATA \n\t = \n ${JSON.stringify({
      loaderData: { 'video_(id)/page': { item: video() } }
    })}</script>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it('throws a stable error when the page signals risk control', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response('<body>访问过于频繁，请完成安全验证</body>'))
    const error = await resolvePublicDouyinVideo(ID, { fetcher }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(DouyinRiskControlError)
    expect(error).toMatchObject({ code: 'DOUYIN_RISK_CONTROL' })
  })

  it('does not treat inactive risk-control fields as an active challenge', async () => {
    const payload = {
      loaderData: {
        'video_(id)/page': {
          risk_control: false,
          risk_control_enabled: false,
          videoInfoRes: { item_list: [video()] }
        }
      }
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(`<script>window._ROUTER_DATA=${JSON.stringify(payload)}</script>`)
    )

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
  })

  it('ignores matching work-shaped data outside known video and note loaders', async () => {
    const payload = { loaderData: { analytics: { event: video() } } }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(`<script>window._ROUTER_DATA=${JSON.stringify(payload)}</script>`)
    )

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('returns null for a non-HTML response even when it contains a router marker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(routerHtml(video()), { headers: { 'content-type': 'application/json' } })
    )

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toBeNull()
  })

  it('rejects a non-numeric video ID before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(resolvePublicDouyinVideo('12x', { fetcher })).rejects.toThrow('INVALID_DOUYIN_VIDEO_ID')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('aborts after the configured timeout', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))

    await expect(resolvePublicDouyinVideo(ID, { fetcher, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_TIMEOUT'
    })
  })

  it('continues past transport failures and reports only sanitized diagnostics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
      new Error('request failed https://media.example.com/video?token=secret')
    )
    const report = vi.fn()

    await expect(resolvePublicDouyinVideo(ID, { fetcher, report })).resolves.toBeNull()
    expect(report).toHaveBeenCalledTimes(4)
    expect(report).toHaveBeenNthCalledWith(1, {
      videoId: ID,
      source: 'share_router',
      outcome: 'request_failed',
      elapsedMs: expect.any(Number)
    })
    expect(JSON.stringify(report.mock.calls)).not.toContain('token=secret')
  })

  it('rejects Content-Length above the configured limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response('small', {
      headers: { 'content-length': '101' }
    }))
    await expect(resolvePublicDouyinVideo(ID, { fetcher, maxBodyBytes: 100 })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE'
    })
  })

  it('cancels a streamed body when accumulated bytes exceed the limit', async () => {
    const cancel = vi.fn()
    const chunks = [new Uint8Array(60), new Uint8Array(60)]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk) controller.enqueue(chunk)
      },
      cancel
    })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'text/html' }
    }))

    await expect(resolvePublicDouyinVideo(ID, { fetcher, maxBodyBytes: 100 })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_BODY_TOO_LARGE'
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('follows relative and allowed-host HTTPS redirects', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `/share/video/${ID}?from=redirect` } }))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: `https://www.douyin.com/share/video/${ID}` } }))
      .mockResolvedValueOnce(response(routerHtml(video())))

    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ videoId: ID })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it.each([
    'http://www.douyin.com/share/video/1',
    'https://evil.example/share/video/1',
    'https://user:secret@www.douyin.com/share/video/1',
    'https://www.douyin.com:444/share/video/1'
  ])('rejects unsafe redirect target %s', async (location) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location } })
    )
    await expect(resolvePublicDouyinVideo(ID, { fetcher })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_UNSAFE_REDIRECT'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing redirect location and more than three redirects', async () => {
    await expect(resolvePublicDouyinVideo(ID, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 }))
    })).rejects.toMatchObject({ code: 'DOUYIN_PUBLIC_SHARE_UNSAFE_REDIRECT' })

    const redirect = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: `/share/video/${ID}` } })
    )
    await expect(resolvePublicDouyinVideo(ID, { fetcher: redirect })).rejects.toMatchObject({
      code: 'DOUYIN_PUBLIC_SHARE_TOO_MANY_REDIRECTS'
    })
    expect(redirect).toHaveBeenCalledTimes(4)
  })

  it.each([
    'http://media.example.com/video.mp4',
    'javascript:alert(1)',
    'https://localhost/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://[::1]/video.mp4',
    'https://v3-web.douyinvod.com.evil.test/video.mp4',
    'https://user:secret@media.example.com/video.mp4',
    'https://media.example.com:444/video.mp4'
  ])('drops unsafe media URL %s', async (mediaUrl) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(routerHtml(video({
      video: { play_addr: { url_list: [mediaUrl] } }
    }))))
    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ downloadUrl: null })
  })

  it('does not replace playwm text outside an exact pathname segment', async () => {
    const mediaUrl = 'https://playwm.example.com/path/replaywm/file.mp4?mode=playwm'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(routerHtml(video({
      video: { play_addr: { url_list: [mediaUrl] } }
    }))))
    await expect(resolvePublicDouyinVideo(ID, { fetcher })).resolves.toMatchObject({ downloadUrl: mediaUrl })
  })
})
