import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  it.each([
    'https://localhost/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://[::1]/video.mp4',
    'https://v3-web.douyinvod.com.evil.test/video.mp4'
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
})
