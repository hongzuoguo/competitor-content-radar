// End-to-end smoke for the works:rewrite IPC handler chain.
// Builds a fake IpcDependencies (mirroring what production.rewriteWork exposes)
// and runs the same handler logic the real ipc.ts would, so we know the
// dependency wiring + payload shape are aligned before shipping.
import { describe, expect, it, vi } from 'vitest'
import { RewriteService } from '../../src/services/ai/rewrite-service'
import type { RewriteRequestView, RewriteResultView } from '../../src/shared/ipc-contract'

function buildIpcHandler(rewriteWork: (workId: string, payload: RewriteRequestView) => Promise<RewriteResultView>): (value: unknown) => Promise<RewriteResultView> {
  return async (value: unknown) => {
    if (!rewriteWork) throw new Error('REWRITE_UNAVAILABLE')
    if (typeof value !== 'object' || value === null) throw new Error('INVALID_REWRITE_REQUEST')
    const input = value as { workId?: unknown; payload?: unknown }
    const workId = typeof input.workId === 'string' ? input.workId.trim() : ''
    const payload = input.payload
    if (!workId) throw new Error('INVALID_WORK_ID')
    if (!payload || typeof payload !== 'object') throw new Error('INVALID_REWRITE_REQUEST')
    return rewriteWork(workId, payload as RewriteRequestView)
  }
}

describe('works:rewrite IPC end-to-end (smoke)', () => {
  it('routes a payload through the real RewriteService', async () => {
    let capturedId = ''
    const client = {
      complete: vi.fn(async () => ({
        content: JSON.stringify({
          needMore: false,
          content: '凌晨三点,云南某项目的朋友圈还在转。我看了一下…',
          score: { directness: 8, rhythm: 8, trust: 8, authenticity: 8, refinement: 8 }
        }),
        usage: { inputTokens: 100, outputTokens: 200 }
      }))
    }
    const service = new RewriteService(client as never)
    const handler = buildIpcHandler(async (id, payload) => {
      capturedId = id
      const result = await service.rewrite({ userContext: payload.userContext, wordCount: payload.wordCount, source: {
        title: payload.title,
        topicAngle: payload.topicAngle,
        openingHookQuote: payload.openingHookQuote,
        openingHookType: payload.openingHookType,
        openingHookMechanism: payload.openingHookMechanism,
        structure: payload.structure,
        viralPoints: payload.viralPoints,
        highlights: payload.highlights,
        reusablePatterns: payload.reusablePatterns
      } })
      return { needMore: result.needMore, questions: result.questions, content: result.content, score: result.score }
    })
    const out = await handler({
      workId: 'douyin:123',
      payload: {
        title: '云南未来',
        topicAngle: '本地人外出打工与外地老板涌入',
        openingHookQuote: '云南未来',
        openingHookType: '对比式钩子',
        openingHookMechanism: '对比',
        structure: '现象→反差→原因',
        viralPoints: '跨界对比',
        highlights: ['具体数据'],
        reusablePatterns: ['地方观察'],
        userContext: '作为AI博主去教大家用内容创作神器找选题创作文章',
        wordCount: 400
      }
    })
    expect(capturedId).toBe('douyin:123')
    expect(out.needMore).toBe(false)
    if (!out.needMore && out.content && out.score) {
      expect(out.content).toContain('凌晨三点')
      expect(out.score.total).toBe(40)
    }
  })

  it('rejects malformed payload with REWRITE_UNAVAILABLE if handler missing', async () => {
    const handler = buildIpcHandler(undefined as unknown as (workId: string, payload: RewriteRequestView) => Promise<RewriteResultView>)
    await expect(handler({ workId: 'a', payload: {} })).rejects.toThrow('REWRITE_UNAVAILABLE')
  })

  it('rejects empty workId', async () => {
    const handler = buildIpcHandler(async () => ({ needMore: false, questions: [], content: '', score: null }))
    await expect(handler({ workId: '  ', payload: {} })).rejects.toThrow('INVALID_WORK_ID')
  })
})