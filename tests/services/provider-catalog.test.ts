import { describe, expect, it } from 'vitest'
import { ModelProfileInputSchema } from '../../src/services/ai/model-profile'
import { AI_PROVIDER_CATALOG } from '../../src/services/ai/provider-catalog'
import type { AiProviderDefinition } from '../../src/services/ai/provider-types'

describe('AI provider catalog', () => {
  it('contains every confirmed provider template', () => {
    expect(AI_PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      'deepseek',
      'doubao',
      'kimi',
      'qwen',
      'custom'
    ])
  })

  it('accepts an arbitrary model ID in a model profile', () => {
    const profile = ModelProfileInputSchema.parse({
      name: 'DeepSeek V5',
      providerTemplate: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v5',
      requiresApiKey: true,
      enabled: true
    })

    expect(profile.modelId).toBe('deepseek-v5')
  })

  it('accepts HTTPS and loopback HTTP model endpoints', () => {
    expect(ModelProfileInputSchema.safeParse({
      name: 'Hosted model',
      providerTemplate: 'custom',
      baseUrl: 'https://models.example.com/v1',
      modelId: 'hosted-model',
      requiresApiKey: true,
      enabled: true
    }).success).toBe(true)

    expect(ModelProfileInputSchema.safeParse({
      name: 'Another local model',
      providerTemplate: 'custom',
      baseUrl: 'http://127.0.0.2:11434/v1',
      modelId: 'local-model',
      requiresApiKey: false,
      enabled: true
    }).success).toBe(true)

    expect(ModelProfileInputSchema.safeParse({
      name: 'Local model',
      providerTemplate: 'custom',
      baseUrl: 'http://[::1]:11434/v1',
      modelId: 'local-model',
      requiresApiKey: false,
      enabled: true
    }).success).toBe(true)
  })

  it('rejects non-loopback HTTP model endpoints', () => {
    expect(ModelProfileInputSchema.safeParse({
      name: 'Insecure remote model',
      providerTemplate: 'custom',
      baseUrl: 'http://models.example.com/v1',
      modelId: 'remote-model',
      requiresApiKey: true,
      enabled: true
    }).success).toBe(false)

    expect(ModelProfileInputSchema.safeParse({
      name: 'Impersonated local model',
      providerTemplate: 'custom',
      baseUrl: 'http://localhost@models.example.com/v1',
      modelId: 'remote-model',
      requiresApiKey: true,
      enabled: true
    }).success).toBe(false)
  })

  it('safely rejects blank and malformed model endpoint URLs', () => {
    for (const baseUrl of ['   ', 'not-a-url']) {
      expect(() => ModelProfileInputSchema.safeParse({
        name: 'Invalid endpoint',
        providerTemplate: 'custom',
        baseUrl,
        modelId: 'invalid-model',
        requiresApiKey: false,
        enabled: true
      })).not.toThrow()
      expect(ModelProfileInputSchema.safeParse({
        name: 'Invalid endpoint',
        providerTemplate: 'custom',
        baseUrl,
        modelId: 'invalid-model',
        requiresApiKey: false,
        enabled: true
      }).success).toBe(false)
    }
  })

  it('contains templates without fixed model lists', () => {
    const templates: AiProviderDefinition[] = AI_PROVIDER_CATALOG

    for (const provider of templates) {
      expect(provider).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        compatibility: expect.any(String)
      })
      expect(provider).toHaveProperty('baseUrl')
      expect(provider).toHaveProperty('docsUrl')
      expect(provider).not.toHaveProperty('models')
    }
  })
})
