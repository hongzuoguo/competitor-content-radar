import { describe, expect, it } from 'vitest'
import { RewriteService, type RewriteRequest } from '../../../src/services/ai/rewrite-service'

function fakeResponse(content: string): { complete: (req: unknown) => Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> } {
  return {
    complete: async () => ({ content, usage: { inputTokens: 100, outputTokens: 200 } })
  } as never
}

const sampleReq: RewriteRequest = {
  userContext: '我是一个做云南旅游的中年博主',
  source: {
    title: '云南未来是个创业项目的抢手地带',
    topicAngle: '本地人外出打工与外地老板涌入的矛盾',
    openingHookQuote: '云南未来',
    openingHookType: '对比式钩子',
    openingHookMechanism: '通对比两个现象引发思考',
    structure: '现象 → 反差 → 原因 → 结论',
    viralPoints: '跨界对比、悬念',
    highlights: ['具体数据', '现场感'],
    reusablePatterns: ['地方观察', '数据引用']
  }
}

describe('RewriteService', () => {
  it('parses a valid needMore:false response', async () => {
    const service = new RewriteService(fakeResponse(JSON.stringify({
      needMore: false,
      content: '凌晨三点,朋友圈里还在转着云南某项目的融资截图。',
      score: { directness: 8, rhythm: 7, trust: 9, authenticity: 8, refinement: 7 }
    })))
    const result = await service.rewrite(sampleReq)
    expect(result.needMore).toBe(false)
    if (!result.needMore) {
      expect(result.content).toContain('凌晨三点')
      expect(result.score.total).toBe(39)
      expect(result.score.directness).toBe(8)
    }
  })

  it('returns questions when needMore:true', async () => {
    const service = new RewriteService(fakeResponse(JSON.stringify({
      needMore: true,
      questions: ['你的目标读者是谁?', '你希望什么语气?'],
      content: null,
      score: null
    })))
    const result = await service.rewrite(sampleReq)
    expect(result.needMore).toBe(true)
    if (result.needMore) {
      expect(result.questions).toEqual(['你的目标读者是谁?', '你希望什么语气?'])
      expect(result.content).toBeNull()
    }
  })

  it('clamps out-of-range scores to 1-10', async () => {
    const service = new RewriteService(fakeResponse(JSON.stringify({
      needMore: false,
      content: '文章',
      score: { directness: 99, rhythm: -5, trust: 'oops' as unknown as number, authenticity: 7, refinement: 7 }
    })))
    const result = await service.rewrite(sampleReq)
    expect(result.needMore).toBe(false)
    if (!result.needMore) {
      expect(result.score.directness).toBe(10)
      expect(result.score.rhythm).toBe(1)
      expect(result.score.trust).toBe(7)
    }
  })

  it('throws AI_REWRITE_INVALID when content and questions are both missing', async () => {
    const service = new RewriteService(fakeResponse(JSON.stringify({ needMore: false, score: {} })))
    await expect(service.rewrite(sampleReq)).rejects.toThrow('AI_REWRITE_INVALID')
  })

  it('throws when response is not JSON', async () => {
    const service = new RewriteService(fakeResponse('不是 JSON'))
    await expect(service.rewrite(sampleReq)).rejects.toThrow('AI_REWRITE_INVALID')
  })

  it('clamps word count to 100-2000 and passes it into the prompt', async () => {
    let capturedPrompt = ''
    const client = {
      complete: async (req: { messages: Array<{ content: string }> }) => {
        capturedPrompt = req.messages[0].content
        return { content: JSON.stringify({ needMore: false, content: '文章', score: {} }), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const service = new RewriteService(client as never)
    await service.rewrite({ ...sampleReq, wordCount: 50 })
    expect(capturedPrompt).toContain('目标约 100 字')
    await service.rewrite({ ...sampleReq, wordCount: 99999 })
    expect(capturedPrompt).toContain('目标约 2000 字')
    await service.rewrite({ ...sampleReq })
    expect(capturedPrompt).toContain('目标约 400 字')
  })

  it('does not inject the transcript into the user prompt', async () => {
    let capturedUserPrompt = ''
    const client = {
      complete: async (req: { messages: Array<{ role: string; content: string }> }) => {
        capturedUserPrompt = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: JSON.stringify({ needMore: false, content: '文章', score: {} }), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const service = new RewriteService(client as never)
    await service.rewrite(sampleReq)
    expect(capturedUserPrompt).not.toContain('吃螃蟹')
    expect(capturedUserPrompt).toContain('AI 拆解结果')
    expect(capturedUserPrompt).toContain('用户个性化背景')
  })

  it('appends followUp Q&A to the user prompt', async () => {
    let capturedUserPrompt = ''
    const client = {
      complete: async (req: { messages: Array<{ role: string; content: string }> }) => {
        capturedUserPrompt = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: JSON.stringify({ needMore: false, content: '文章', score: {} }), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const service = new RewriteService(client as never)
    await service.rewrite({
      ...sampleReq,
      followUp: { questions: ['你的目标读者是谁?'], answers: '30-40 岁的创业新手' }
    })
    expect(capturedUserPrompt).toContain('你的目标读者是谁?')
    expect(capturedUserPrompt).toContain('30-40 岁的创业新手')
  })
})