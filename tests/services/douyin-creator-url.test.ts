import { describe, expect, it, vi } from 'vitest'
import { resolveDouyinCreatorUrl } from '../../src/services/douyin/creator-url'

describe('Douyin creator URL resolution', () => {
  it('extracts a creator card short link and follows redirects manually', async () => {
    const fetchRedirect = vi.fn(async () => new Response(null, {
      status: 302,
      headers: {
        location: 'https://www.iesdouyin.com/share/user/MS4wLjABAAAA-example?from_ssr=1'
      }
    }))

    await expect(resolveDouyinCreatorUrl(
      '3- 长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/jI79SWk4jwA/ 2@9.com :0pm',
      fetchRedirect
    )).resolves.toBe('https://www.douyin.com/user/MS4wLjABAAAA-example')
    expect(fetchRedirect).toHaveBeenCalledWith(
      'https://v.douyin.com/jI79SWk4jwA/',
      { redirect: 'manual' }
    )
  })

  it('normalizes a direct creator URL without fetching it', async () => {
    const fetchRedirect = vi.fn()

    await expect(resolveDouyinCreatorUrl(
      'https://www.douyin.com/user/direct-user?from_tab_name=main',
      fetchRedirect
    )).resolves.toBe('https://www.douyin.com/user/direct-user')
    expect(fetchRedirect).not.toHaveBeenCalled()
  })

  it('rejects input containing more than one allowed Douyin URL', async () => {
    await expect(resolveDouyinCreatorUrl(
      'https://v.douyin.com/first/ https://www.douyin.com/user/second',
      vi.fn()
    )).rejects.toThrow('INVALID_DOUYIN_CREATOR_URL')
  })

  it('rejects a short-link redirect outside allowed Douyin hosts', async () => {
    const fetchRedirect = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/user/stolen' }
    }))

    await expect(resolveDouyinCreatorUrl(
      'https://v.douyin.com/unsafe/',
      fetchRedirect
    )).rejects.toThrow('UNSAFE_DOUYIN_CREATOR_REDIRECT')
  })

  it('stops after a finite number of short-link redirects', async () => {
    const fetchRedirect = vi.fn(async (url: string) => new Response(null, {
      status: 302,
      headers: { location: `${url}${fetchRedirect.mock.calls.length}/` }
    }))

    await expect(resolveDouyinCreatorUrl(
      'https://v.douyin.com/loop/',
      fetchRedirect
    )).rejects.toThrow('DOUYIN_CREATOR_REDIRECT_LIMIT')
    expect(fetchRedirect).toHaveBeenCalledTimes(5)
  })
})
