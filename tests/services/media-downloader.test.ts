import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadMedia } from '../../src/services/media/downloader'

const directories: string[] = []

async function destination(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'content-radar-download-'))
  directories.push(directory)
  return join(directory, 'video.mp4')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('media downloader URL safety', () => {
  it('accepts only the constrained ctydoh media proxy shape', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('proxied-video', { status: 200 }))
    const path = await destination()

    await downloadMedia(
      'https://edge.ctydoh.cn:20002/v95-dy-o-abtest.douyinvod.com/video.mp4',
      path,
      fetcher
    )

    expect(await readFile(path, 'utf8')).toBe('proxied-video')
  })

  it.each([
    'https://localhost/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://[::1]/video.mp4',
    'https://v3-web.douyinvod.com.evil.test/video.mp4',
    'https://ctydoh.cn:20002/v95.douyinvod.com/video.mp4',
    'https://edge.ctydoh.cn/v95.douyinvod.com/video.mp4',
    'https://edge.ctydoh.cn:443/v95.douyinvod.com/video.mp4',
    'https://edge.ctydoh.cn:20002/evil.test/video.mp4',
    'https://edge.ctydoh.cn:20002/media.example.com/video.mp4',
    'https://edge.ctydoh.cn:20002/127.0.0.1/video.mp4',
    'https://user@edge.ctydoh.cn:20002/v95.douyinvod.com/video.mp4'
  ])('rejects an unsafe initial media URL before fetching: %s', async (url) => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(downloadMedia(url, await destination(), fetcher)).rejects.toMatchObject({
      code: 'UNSAFE_MEDIA_URL'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a redirect from an allowed CDN to an internal address', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })
    )

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      await destination(),
      fetcher
    )).rejects.toMatchObject({ code: 'UNSAFE_MEDIA_URL' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('follows an allowed CDN redirect manually and writes the final body', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://v9-dy-o-abtest.zjcdn.com/final.mp4' }
      }))
      .mockResolvedValueOnce(new Response('video-bytes', { status: 200 }))
    const path = await destination()

    await downloadMedia('https://v3-web.douyinvod.com/start.mp4', path, fetcher)

    expect(await readFile(path, 'utf8')).toBe('video-bytes')
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit' })
    }
  })

  it('retries a transport failure and then writes the successful response', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('video-after-retry', { status: 200 }))
    const path = await destination()

    await downloadMedia('https://v3-web.douyinvod.com/video.mp4', path, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(path, 'utf8')).toBe('video-after-retry')
  })

  it('stops after three transport failures', async () => {
    const failure = new TypeError('fetch failed')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure)

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      await destination(),
      fetcher
    )).rejects.toMatchObject({ code: 'DOUYIN_DOWNLOAD_FAILED', message: 'MEDIA_DOWNLOAD_TRANSPORT_FAILED' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not consume the next request retry budget on a successful redirect', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://v9-dy-o-abtest.zjcdn.com/final.mp4' }
      }))
      .mockRejectedValueOnce(new TypeError('first final fetch failed'))
      .mockRejectedValueOnce(new TypeError('second final fetch failed'))
      .mockResolvedValueOnce(new Response('video-after-redirect-retries', { status: 200 }))
    const path = await destination()

    await downloadMedia(
      'https://v3-web.douyinvod.com/start.mp4',
      path,
      fetcher
    )

    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(await readFile(path, 'utf8')).toBe('video-after-redirect-retries')
  })

  it('does not retry an HTTP failure', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const response = new Response('unavailable', { status: 503 })
    vi.spyOn(response.body!, 'cancel').mockImplementation(cancel)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      await destination(),
      fetcher
    )).rejects.toMatchObject({ code: 'DOUYIN_DOWNLOAD_FAILED', message: 'MEDIA_DOWNLOAD_HTTP_503' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    [5, 'bytes 4-9/10'],
    [0, 'bytes 5-9/10'],
    [5, 'bytes 5-8/10'],
    [5, 'bytes 5-9/*'],
    [5, null]
  ] as const)('rejects an invalid 206 Content-Range for offset %s: %s', async (offset, contentRange) => {
    const path = await destination()
    if (offset > 0) await writeFile(path, 'x'.repeat(offset))
    const headers = contentRange ? { 'content-range': contentRange } : undefined
    const cancel = vi.fn().mockResolvedValue(undefined)
    const response = new Response('partial', { status: 206, headers })
    vi.spyOn(response.body!, 'cancel').mockImplementation(cancel)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      path,
      fetcher
    )).rejects.toMatchObject({ code: 'MEDIA_DOWNLOAD_INVALID_CONTENT_RANGE' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a 206 response when the written file is shorter than the declared total', async () => {
    const path = await destination()
    await writeFile(path, '12345')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('6789', {
      status: 206,
      headers: { 'content-range': 'bytes 5-9/10' }
    }))

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      path,
      fetcher
    )).rejects.toMatchObject({ code: 'DOUYIN_DOWNLOAD_FAILED', message: 'MEDIA_DOWNLOAD_SIZE_MISMATCH' })
    expect((await readFile(path)).length).toBe(9)
  })

  it.each([null, 'https://['])('reports an invalid redirect Location independently: %s', async (location) => {
    const headers = location === null ? undefined : { location }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers }))

    await expect(downloadMedia(
      'https://v3-web.douyinvod.com/video.mp4',
      await destination(),
      fetcher
    )).rejects.toMatchObject({ code: 'MEDIA_DOWNLOAD_INVALID_REDIRECT' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
