import { describe, expect, it } from 'vitest'
import { toFeishuUserError } from '../../src/services/feishu/user-error'

describe('toFeishuUserError', () => {
  it.each([
    ['FEISHU_BASE_URL_INVALID', {
      code: 'FEISHU_URL_INVALID',
      title: '链接无法识别',
      reason: '不是有效的飞书多维表格链接',
      action: '请复制以 /base/ 或 /wiki/ 开头的完整链接',
      retryable: false
    }],
    ['FEISHU_WIKI_NOT_BITABLE', {
      code: 'FEISHU_WIKI_NOT_BITABLE',
      title: '该知识库页面不是多维表格',
      reason: '页面实际类型不受支持',
      action: '请打开多维表格页面后重新复制链接',
      retryable: false
    }],
    ['FEISHU_API_1254302: 网络异常', {
      code: 'FEISHU_PERMISSION_DENIED',
      title: '飞书拒绝了访问',
      reason: '应用权限未发布，或目标 Base 未授权该应用管理',
      action: '请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限',
      retryable: false
    }],
    ['FEISHU_HTTP_403: network error', {
      code: 'FEISHU_PERMISSION_DENIED',
      title: '飞书拒绝了访问',
      reason: '应用权限未发布，或目标 Base 未授权该应用管理',
      action: '请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限',
      retryable: false
    }],
    ['FEISHU_API_424242:HTTP_403 Bearer fake-access-token', {
      code: 'FEISHU_PERMISSION_DENIED',
      title: '飞书拒绝了访问',
      reason: '应用权限未发布，或目标 Base 未授权该应用管理',
      action: '请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限',
      retryable: false
    }],
    ['FEISHU_API_424242:HTTP_429 {"detail":"raw response body"}', {
      code: 'FEISHU_NETWORK_ERROR',
      title: '暂时无法连接飞书',
      reason: '网络、代理或飞书服务异常',
      action: '请检查网络后重试',
      retryable: true
    }],
    ['FEISHU_API_424242:HTTP_503', {
      code: 'FEISHU_NETWORK_ERROR',
      title: '暂时无法连接飞书',
      reason: '网络、代理或飞书服务异常',
      action: '请检查网络后重试',
      retryable: true
    }],
    ['FEISHU_HTTP_401', {
      code: 'FEISHU_SECRET_INVALID',
      title: '应用凭证无效',
      reason: 'App ID 或 App Secret 不匹配',
      action: '请重新复制凭证后测试',
      retryable: false
    }],
    ['FEISHU_API_424242:HTTP_401', {
      code: 'FEISHU_SECRET_INVALID',
      title: '应用凭证无效',
      reason: 'App ID 或 App Secret 不匹配',
      action: '请重新复制凭证后测试',
      retryable: false
    }],
    ['FEISHU_CUSTOM_APP_CREDENTIALS_INVALID', {
      code: 'FEISHU_SECRET_INVALID',
      title: '应用凭证无效',
      reason: 'App ID 或 App Secret 不匹配',
      action: '请重新复制凭证后测试',
      retryable: false
    }],
    ['FEISHU_CUSTOM_APP_AUTH_NETWORK', {
      code: 'FEISHU_NETWORK_ERROR',
      title: '暂时无法连接飞书',
      reason: '网络、代理或飞书服务异常',
      action: '请检查网络后重试',
      retryable: true
    }],
    ['unexpected failure', {
      code: 'FEISHU_UNKNOWN_ERROR',
      title: '飞书操作失败',
      reason: '未能确认具体原因',
      action: '请重试；如仍失败，请检查应用配置',
      retryable: true
    }]
  ])('returns safe Chinese copy for %s', (source, expected) => {
    expect(toFeishuUserError(new Error(source))).toEqual(expected)
  })

  it('uses a known API code before generic text and never returns secrets or response bodies', () => {
    const payload = toFeishuUserError(new Error(
      'FEISHU_API_1254302: network error Bearer fake-access-token {"app_secret":"fake-app-secret","detail":"raw response body"}'
    ))

    expect(payload.code).toBe('FEISHU_PERMISSION_DENIED')
    expect(JSON.stringify(payload)).not.toContain('fake-access-token')
    expect(JSON.stringify(payload)).not.toContain('fake-app-secret')
    expect(JSON.stringify(payload)).not.toContain('raw response body')
  })

  it('explains the Wiki permission required by a Wiki node lookup', () => {
    const payload = toFeishuUserError(new Error('FEISHU_API_99991672:wiki.node'))

    expect(payload.code).toBe('FEISHU_PERMISSION_DENIED')
    expect(payload.action).toContain('查看知识空间节点信息')
    expect(payload.action).toContain('添加该应用为文档应用')
  })

  it('returns a fresh payload when a previous caller mutates its result', () => {
    const first = toFeishuUserError(new Error('FEISHU_BASE_URL_INVALID'))
    first.title = '污染后的标题'

    expect(toFeishuUserError(new Error('FEISHU_BASE_URL_INVALID')).title).toBe('链接无法识别')
  })

  it('falls back safely when an error-like object throws while its code is read', () => {
    const hostileError = new Proxy({}, {
      get() {
        throw new Error('Bearer fake-access-token')
      }
    })

    expect(toFeishuUserError(hostileError)).toEqual({
      code: 'FEISHU_UNKNOWN_ERROR',
      title: '飞书操作失败',
      reason: '未能确认具体原因',
      action: '请重试；如仍失败，请检查应用配置',
      retryable: true
    })
  })
})
