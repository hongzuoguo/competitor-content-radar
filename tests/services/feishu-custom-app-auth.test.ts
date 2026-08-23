import { describe, expect, it, vi } from 'vitest'
import {
  FeishuTenantTokenProvider,
  parseFeishuBaseReference
} from '../../src/services/feishu/custom-app-auth'

describe('Feishu custom-app authentication', () => {
  it('parses a Feishu Base URL into a base reference', () => {
    expect(parseFeishuBaseReference(
      ' https://example.feishu.cn/base/appbcbWCzen6D8dezhoCH2RpMAh?table=tbl-one '
    )).toEqual({
      kind: 'base',
      appToken: 'appbcbWCzen6D8dezhoCH2RpMAh',
      tableId: 'tbl-one'
    })
  })

  it('parses a Feishu Wiki URL into a wiki reference', () => {
    expect(parseFeishuBaseReference(
      'https://example.feishu.cn/wiki/wikcn123?table=tbl1'
    )).toEqual({
      kind: 'wiki',
      nodeToken: 'wikcn123',
      tableId: 'tbl1'
    })
  })

  it('accepts an explicit app token as a base reference', () => {
    expect(parseFeishuBaseReference(' appbcbWCzen6D8dezhoCH2RpMAh ')).toEqual({
      kind: 'base',
      appToken: 'appbcbWCzen6D8dezhoCH2RpMAh',
      tableId: null
    })
  })

  it('returns null for an invalid table query token', () => {
    expect(parseFeishuBaseReference(
      'https://example.feishu.cn/base/appToken?table=not%20a%20token'
    )).toEqual({
      kind: 'base',
      appToken: 'appToken',
      tableId: null
    })
  })

  it.each([
    ['http://example.feishu.cn/base/appToken', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.com/base/appToken', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/base/', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/wiki/', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/base//appToken', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/wiki//wikcnToken', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/base/appToken/', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/wiki/wikcnToken/', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/docx/doccnToken', 'FEISHU_BASE_URL_INVALID'],
    ['https://example.feishu.cn/base/appToken/extra', 'FEISHU_BASE_URL_INVALID'],
    ['not a token', 'FEISHU_BASE_URL_INVALID']
  ])('rejects invalid Base reference %s', (value, code) => {
    expect(() => parseFeishuBaseReference(value)).toThrow(code)
  })

  it('requests tenant_access_token with trimmed credentials', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(tokenResponse('tenant-token', 7_200))
    const provider = new FeishuTenantTokenProvider(
      { appId: ' cli_example ', appSecret: ' secret-value ' },
      { fetchImplementation }
    )

    await expect(provider.getAccessToken()).resolves.toBe('tenant-token')

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: 'cli_example', app_secret: 'secret-value' })
      })
    )
  })

  it('maps rejected credentials to a stable error code', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 10003,
      msg: 'app secret invalid'
    }), { status: 200 }))
    const provider = new FeishuTenantTokenProvider(
      { appId: 'cli_example', appSecret: 'wrong-secret' },
      { fetchImplementation }
    )

    await expect(provider.getAccessToken()).rejects.toThrow(
      'FEISHU_CUSTOM_APP_CREDENTIALS_INVALID'
    )
  })

  it('caches a token until five minutes before expiry', async () => {
    let now = Date.parse('2026-08-07T00:00:00.000Z')
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(tokenResponse('tenant-token-1', 600))
      .mockResolvedValueOnce(tokenResponse('tenant-token-2', 600))
    const provider = new FeishuTenantTokenProvider(
      { appId: 'cli_example', appSecret: 'secret-value' },
      { fetchImplementation, now: () => now }
    )

    await expect(provider.getAccessToken()).resolves.toBe('tenant-token-1')
    now += 299_000
    await expect(provider.getAccessToken()).resolves.toBe('tenant-token-1')
    expect(fetchImplementation).toHaveBeenCalledTimes(1)

    now += 2_000
    await expect(provider.getAccessToken()).resolves.toBe('tenant-token-2')
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent token refreshes', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchImplementation = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    const provider = new FeishuTenantTokenProvider(
      { appId: 'cli_example', appSecret: 'secret-value' },
      { fetchImplementation }
    )

    const first = provider.getAccessToken()
    const second = provider.getAccessToken()
    expect(fetchImplementation).toHaveBeenCalledTimes(1)

    resolveResponse(tokenResponse('shared-tenant-token', 7_200))

    await expect(Promise.all([first, second])).resolves.toEqual([
      'shared-tenant-token',
      'shared-tenant-token'
    ])
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('never logs the app secret or tenant token', async () => {
    const log = vi.fn()
    const fetchImplementation = vi.fn().mockResolvedValue(tokenResponse('never-log-token', 7_200))
    const provider = new FeishuTenantTokenProvider(
      { appId: 'cli_example', appSecret: 'never-log-secret' },
      { fetchImplementation, log }
    )

    await provider.getAccessToken()

    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('never-log-secret')
    expect(logged).not.toContain('never-log-token')
  })
})

function tokenResponse(token: string, expire: number): Response {
  return new Response(JSON.stringify({
    code: 0,
    msg: 'ok',
    tenant_access_token: token,
    expire
  }), { status: 200 })
}
