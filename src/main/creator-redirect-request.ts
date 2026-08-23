import { net } from 'electron'
import type { CreatorRedirectFetch } from '../services/douyin/creator-url'

export interface CreatorRedirectRequest {
  on(event: 'redirect', listener: (statusCode: number, method: string, redirectUrl: string) => void): this
  on(event: 'response', listener: (response: {
    statusCode: number
    headers: Record<string, string | string[]>
  }) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  end(): void
}

type RequestFactory = (url: string) => CreatorRedirectRequest

export function createCreatorRedirectFetch(
  requestFactory: RequestFactory = (url) => net.request({ method: 'GET', url, redirect: 'manual' }) as CreatorRedirectRequest
): CreatorRedirectFetch {
  return (url) => new Promise((resolve, reject) => {
    const request = requestFactory(url)
    let settled = false

    request.on('redirect', (statusCode, _method, redirectUrl) => {
      if (settled) return
      settled = true
      resolve({ status: statusCode, headers: new Headers({ location: redirectUrl }) })
    })
    request.on('response', (response) => {
      if (settled) return
      settled = true
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
      }
      resolve({ status: response.statusCode, headers })
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    request.end()
  })
}
