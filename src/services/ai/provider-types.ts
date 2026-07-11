export type AiProviderId = 'deepseek' | 'doubao' | 'kimi' | 'qwen' | 'custom'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model?: string
  messages: ChatMessage[]
  temperature?: number
  responseFormat?: 'json_object'
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatCompletionResponse {
  content: string
  usage: TokenUsage
}

export interface ChatCompletionClient {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
}

export interface ProviderModel {
  id: string
  label: string
  recommended?: boolean
}

export interface AiProviderDefinition {
  id: AiProviderId
  label: string
  baseUrl: string | null
  models: ProviderModel[]
}
