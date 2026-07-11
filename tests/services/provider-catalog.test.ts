import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_CATALOG, resolveModel } from '../../src/services/ai/provider-catalog'

describe('AI provider catalog', () => {
  it('contains every confirmed provider family', () => {
    expect(AI_PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      'deepseek',
      'doubao',
      'kimi',
      'qwen',
      'custom'
    ])
  })

  it('recommends Kimi K2.6 and Qwen 3.7 Plus for content analysis', () => {
    expect(resolveModel('kimi', 'recommended').label).toBe('Kimi K2.6')
    expect(resolveModel('qwen', 'recommended').label).toBe('Qwen 3.7 Plus')
  })

  it('keeps a manually entered model ID for custom compatible providers', () => {
    expect(resolveModel('custom', 'my-private-model').id).toBe('my-private-model')
  })
})
