import type { AiProviderDefinition, AiProviderId, ProviderModel } from './provider-types'

export const AI_PROVIDER_CATALOG: AiProviderDefinition[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', recommended: true },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' }
    ]
  },
  {
    id: 'doubao',
    label: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro', recommended: true },
      { id: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite' },
      { id: 'doubao-seed-2.0-mini', label: 'Doubao Seed 2.0 Mini' }
    ]
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2.6', label: 'Kimi K2.6', recommended: true },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' }
    ]
  },
  {
    id: 'qwen',
    label: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', recommended: true },
      { id: 'qwen3.7-max', label: 'Qwen 3.7 Max' },
      { id: 'qwen3.6-flash', label: 'Qwen 3.6 Flash' }
    ]
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    baseUrl: null,
    models: []
  }
]

export function resolveModel(providerId: AiProviderId, modelId: string): ProviderModel {
  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === providerId)
  if (!provider) throw new Error(`UNKNOWN_AI_PROVIDER:${providerId}`)

  if (modelId === 'recommended') {
    const recommended = provider.models.find((model) => model.recommended)
    if (!recommended) throw new Error(`NO_RECOMMENDED_MODEL:${providerId}`)
    return recommended
  }

  return provider.models.find((model) => model.id === modelId) ?? { id: modelId, label: modelId }
}
