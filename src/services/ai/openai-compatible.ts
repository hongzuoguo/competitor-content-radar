import type {
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatCompletionResponse
} from './provider-types'

interface ClientOptions {
  baseUrl: string
  apiKey: string
  model: string
  fetchImplementation?: typeof fetch
}

export class OpenAiCompatibleClient implements ChatCompletionClient {
  private readonly fetchImplementation: typeof fetch

  constructor(private readonly options: ClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await this.fetchImplementation(
      `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model ?? this.options.model,
          messages: request.messages,
          temperature: request.temperature,
          response_format:
            request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
        })
      }
    )

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after')
      throw new Error(`AI_HTTP_${response.status}${retryAfter ? `:RETRY_AFTER=${retryAfter}` : ''}`)
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new Error('AI_EMPTY_RESPONSE')

    return {
      content,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0
      }
    }
  }
}
