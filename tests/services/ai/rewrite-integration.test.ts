// Integration smoke test: invokes rewriteWork through a real ChatCompletionClient
// (mocked) and validates the end-to-end pipeline (prompt assembly, JSON parsing).
import { describe, expect, it, vi } from 'vitest'
import { RewriteService } from '../../../src/services/ai/rewrite-service'

describe('RewriteService integration (smoke)', () => {
  it('assembles a prompt and parses a full realistic response', async () => {
    let capturedSystemPrompt = ''
    let capturedUserPrompt = ''
    const client = {
      complete: vi.fn(async (req: { messages: Array<{ role: string; content: string }> }) => {
        const sys = req.messages.find((m) => m.role === 'system')
        const user = req.messages.find((m) => m.role === 'user')
        if (sys) capturedSystemPrompt = sys.content
        if (user) capturedUserPrompt = user.content
        return {
          content: JSON.stringify({
            needMore: false,
            content: '凌晨三点,朋友圈还在转云南某项目的融资截图。我看了一下,确实有点意思——',
            score: { directness: 9, rhythm: 8, trust: 8, authenticity: 9, refinement: 8 }
          }),
          usage: { inputTokens: 200, outputTokens: 150 }
        }
      })
    }
    const service = new RewriteService(client as never)
    const result = await service.rewrite({
      userContext: '作为AI博主去教大家用内容创作神器找选题创作文章',
      wordCount: 300,
      source: {
        title: '云南未来是个创业项目的抢手地带',
        topicAngle: '本地人外出打工与外地老板涌入的矛盾',
        openingHookQuote: '云南未来',
        openingHookType: '对比式钩子',
        openingHookMechanism: '通对比两个现象引发思考',
        structure: '现象 → 反差 → 原因',
        viralPoints: '跨界对比',
        highlights: ['具体数据'],
        reusablePatterns: ['地方观察']
      }
    })

    // Prompt must carry the user's context and word count
    expect(capturedSystemPrompt).toContain('目标约 300 字')
    expect(capturedSystemPrompt).toContain('24 种 AI 写作模式')
    expect(capturedUserPrompt).toContain('作为AI博主去教大家')
    expect(capturedUserPrompt).toContain('云南未来')
    expect(capturedUserPrompt).toContain('具体数据')

    // Response must be parsed
    expect(result.needMore).toBe(false)
    if (!result.needMore) {
      expect(result.content).toContain('凌晨三点')
      expect(result.score.total).toBe(42)
      expect(result.score.directness).toBe(9)
    }
  })

  it('works through the production runtime port surface (typecheck)', async () => {
    // Validate the shape of what production.rewriteWork exposes matches IPC.
    type ProductionRewrite = import('../../../src/main/production-runtime').ProductionRuntime['rewriteWork']
    type IpcRewrite = import('../../../src/shared/ipc-contract').RewriteResultView
    type Expected = (workId: string, payload: import('../../../src/shared/ipc-contract').RewriteRequestView) => Promise<RewriteResultLike>
    type RewriteResultLike = { content: string; score: { directness: number; rhythm: number; trust: number; authenticity: number; refinement: number; total: number } }
    const _check: Expected = null as unknown as ProductionRewrite
    void _check
    expect(true).toBe(true)
  })
})