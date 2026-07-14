import { describe, expect, it, vi } from 'vitest'
import { GetBijiClient, GetBijiError } from '../../src/services/get-biji/client'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('GetBijiClient', () => {
  it('sends official authentication headers and parses bloggers', async () => {
    const fetcher = vi.fn(async () => response({
      success: true,
      data: { bloggers: [{ follow_id: 'f-1', nickname: '林克AI实战录', profile_url: 'https://www.douyin.com/user/u-1' }] }
    }))
    const client = new GetBijiClient({ clientId: 'cli_test', apiKey: 'gk_live_test', topicId: 'topic-1', fetcher })

    await expect(client.listBloggers()).resolves.toEqual([
      { followId: 'f-1', name: '林克AI实战录', profileUrl: 'https://www.douyin.com/user/u-1' }
    ])
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/knowledge/bloggers?topic_id=topic-1&page=1'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'gk_live_test', 'X-Client-ID': 'cli_test' }) })
    )
  })

  it('parses content metrics and original transcript defensively', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ success: true, data: { contents: [{
        post_id_alias: 'p-1', title: '标题', published_at: '2026-07-14 08:00:00',
        original_url: 'https://www.douyin.com/video/1', like_count: 123, comment_count: 4,
        share_count: 5, collect_count: 6
      }] } }))
      .mockResolvedValueOnce(response({ success: true, data: { content: {
        post_id_alias: 'p-1', original: '完整视频文案', original_url: 'https://www.douyin.com/video/1'
      } } }))
    const client = new GetBijiClient({ clientId: 'cli_test', apiKey: 'gk_live_test', topicId: 'topic-1', fetcher })

    await expect(client.listContents('f-1')).resolves.toEqual([expect.objectContaining({
      postId: 'p-1', title: '标题', metrics: { likes: 123, comments: 4, shares: 5, collects: 6 }
    })])
    await expect(client.getContentDetail('p-1')).resolves.toEqual(expect.objectContaining({ transcript: '完整视频文案' }))
  })

  it('maps authentication failures to a stable actionable error', async () => {
    const client = new GetBijiClient({
      clientId: 'bad', apiKey: 'bad', topicId: 'topic-1', fetcher: vi.fn(async () => response({ message: 'unauthorized' }, 401))
    })
    await expect(client.listBloggers()).rejects.toEqual(expect.objectContaining<GetBijiError>({
      code: 'GET_BIJI_AUTH_FAILED', message: '得到大脑凭证无效，请检查 Client ID 和 API Key。'
    }))
  })
})

