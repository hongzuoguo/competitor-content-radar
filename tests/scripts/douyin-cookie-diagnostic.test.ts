import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { fingerprintCookieRows, fingerprintPlainCookieRows, summarizeDouyinResponse } = require('../../scripts/douyin-cookie-diagnostic.cjs') as {
  fingerprintCookieRows(rows: Array<Record<string, unknown>>): {
    cookieCount: number
    sessionCount: number
    fingerprint: string
    session: Array<{ name: string, valueHashPrefix: string }>
  }
  fingerprintPlainCookieRows(rows: Array<Record<string, unknown>>): {
    cookieCount: number
    sessionCount: number
    fingerprint: string
  }
  summarizeDouyinResponse(url: string, status: number, body: string): Record<string, unknown>
}

describe('Douyin cookie diagnostic', () => {
  it('produces a stable fingerprint without exposing encrypted cookie values', () => {
    const secret = Buffer.from('secret-cookie-value')
    const rows = [{
      host_key: '.douyin.com', name: 'sessionid', path: '/', expires_utc: 123,
      is_secure: 1, is_httponly: 1, encrypted_value: secret
    }]

    const first = fingerprintCookieRows(rows)
    const second = fingerprintCookieRows(rows)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ cookieCount: 1, sessionCount: 1 })
    expect(first.session[0].name).toBe('sessionid')
    expect(first.session[0].valueHashPrefix).toHaveLength(12)
    expect(JSON.stringify(first)).not.toContain(secret.toString('utf8'))
  })

  it('fingerprints live CDP cookies without exposing plaintext values', () => {
    const rows = [{
      domain: '.douyin.com', name: 'sessionid', path: '/', expires: 1786400000,
      secure: true, httpOnly: true, value: 'plain-secret-cookie'
    }]

    const result = fingerprintPlainCookieRows(rows)

    expect(result).toMatchObject({ cookieCount: 1, sessionCount: 1 })
    expect(JSON.stringify(result)).not.toContain('plain-secret-cookie')
  })

  it('summarizes a headed Douyin response without retaining its query or body', () => {
    const summary = summarizeDouyinResponse(
      'https://www.douyin.com/aweme/v1/web/aweme/post/?msToken=secret-token',
      200,
      JSON.stringify({
        status_code: 0,
        not_login_module: { guide_login_tip_exist: false },
        aweme_list: [{ aweme_id: '1', secret: 'private-body-value' }]
      })
    )

    expect(summary).toMatchObject({
      urlPath: '/aweme/v1/web/aweme/post/', httpStatus: 200,
      statusCode: 0, loginGuide: false, awemeCount: 1
    })
    expect(JSON.stringify(summary)).not.toContain('secret-token')
    expect(JSON.stringify(summary)).not.toContain('private-body-value')
  })
})
