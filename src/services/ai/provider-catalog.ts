import type { AiProviderDefinition } from './provider-types'

export const AI_PROVIDER_CATALOG = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://api-docs.deepseek.com/',
    compatibility: 'openai-compatible'
  },
  {
    id: 'doubao',
    label: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    docsUrl: 'https://www.volcengine.com/docs/82379/1099455',
    compatibility: 'openai-compatible'
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs/',
    compatibility: 'openai-compatible'
  },
  {
    id: 'qwen',
    label: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
    compatibility: 'openai-compatible'
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    baseUrl: null,
    docsUrl: null,
    compatibility: 'openai-compatible'
  }
] satisfies AiProviderDefinition[]
