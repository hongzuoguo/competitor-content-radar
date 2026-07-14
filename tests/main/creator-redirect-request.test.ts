import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCreatorRedirectFetch, type CreatorRedirectRequest } from '../../src/main/creator-redirect-request'

describe('creator redirect request', () => {
  it('returns the redirect target before Electron reports the cancelled manual redirect', async () => {
    const request = new EventEmitter() as CreatorRedirectRequest & EventEmitter
    request.end = vi.fn(() => {
      request.emit('redirect', 302, 'GET', 'https://www.iesdouyin.com/share/user/creator-id')
      request.emit('error', new Error('Redirect was cancelled'))
    })
    const fetchRedirect = createCreatorRedirectFetch(() => request)

    const response = await fetchRedirect('https://v.douyin.com/card/', { redirect: 'manual' })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://www.iesdouyin.com/share/user/creator-id')
    expect(request.end).toHaveBeenCalledOnce()
  })
})
