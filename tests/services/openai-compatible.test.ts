import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleClient } from '../../src/services/ai/openai-compatible'

function completionResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'completed' } }],
    usage: { prompt_tokens: 3, completion_tokens: 5 }
  }), { status: 200 })
}

describe('OpenAiCompatibleClient', () => {
  afterEach(() => vi.useRealTimers())

  it('omits Authorization for a keyless local endpoint', async () => {
    const fetchImplementation = vi.fn(async () => completionResponse()) as unknown as typeof fetch
    const client = new OpenAiCompatibleClient({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: null,
      model: 'local-model',
      fetchImplementation
    })

    await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-model',
          messages: [{ role: 'user', content: 'hello' }],
          temperature: undefined,
          max_tokens: undefined,
          response_format: undefined,
          thinking: undefined
        })
      })
    )
  })

  it('omits Authorization for an empty API key', async () => {
    const fetchImplementation = vi.fn(async () => completionResponse()) as unknown as typeof fetch
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      model: 'hosted-model',
      fetchImplementation
    })

    await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    )
  })

  it('sends a bearer Authorization header when a key is supplied', async () => {
    const fetchImplementation = vi.fn(async () => completionResponse()) as unknown as typeof fetch
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret-key',
      model: 'hosted-model',
      fetchImplementation
    })

    await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer secret-key',
          'Content-Type': 'application/json'
        }
      })
    )
  })

  it('aborts an in-flight request when its timeout expires', async () => {
    vi.useFakeTimers()
    let aborted = false
    const fetchImplementation = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('Request aborted', 'AbortError'))
      })
    })) as unknown as typeof fetch
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'hosted-model',
      requestTimeoutMs: 10, fetchImplementation
    })

    const completion = client.complete({ messages: [{ role: 'user', content: 'hello' }] })
    const assertion = expect(completion).rejects.toThrow('AI_REQUEST_TIMEOUT')
    await vi.advanceTimersByTimeAsync(10)

    await assertion
    expect(aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the request timeout after a prompt response', async () => {
    vi.useFakeTimers()
    const fetchImplementation = vi.fn(async () => completionResponse()) as unknown as typeof fetch
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'hosted-model',
      requestTimeoutMs: 10, fetchImplementation
    })

    await expect(client.complete({ messages: [{ role: 'user', content: 'hello' }] })).resolves.toMatchObject({ content: 'completed' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
