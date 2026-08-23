import { describe, expect, it } from 'vitest'
import {
  FEISHU_TEMPLATE_APP_TOKEN,
  FEISHU_TEMPLATE_URL,
  isFeishuTemplateUrl
} from '../../src/shared/feishu-template'

describe('Feishu template identity', () => {
  it('exposes the public Base template URL and app token', () => {
    expect(FEISHU_TEMPLATE_URL).toBe(
      'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic'
    )
    expect(FEISHU_TEMPLATE_APP_TOKEN).toBe('UhZ6bYe6aafexms9WGXcomHInic')
  })

  it.each([
    'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic',
    'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic?table=tbl123&view=vew456'
  ])('recognizes the public Base template URL: %s', (value) => {
    expect(isFeishuTemplateUrl(value)).toBe(true)
  })

  it.each([
    'https://example.feishu.cn/base/UserOwnedCopyToken',
    'https://example.com/base/UhZ6bYe6aafexms9WGXcomHInic',
    'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic/anything',
    'not-a-url',
    ''
  ])('rejects a non-template value: %s', (value) => {
    expect(isFeishuTemplateUrl(value)).toBe(false)
  })
})
