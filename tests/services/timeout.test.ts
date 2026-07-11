import { describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../../src/services/pipeline/timeout'

describe('operation timeout', () => {
  it('rejects an operation that never settles with the supplied error', async () => {
    vi.useFakeTimers()
    const error = Object.assign(new Error('抖音主页加载超时'), { code: 'DOUYIN_LOAD_TIMEOUT' })
    const result = withTimeout(new Promise<never>(() => undefined), 30_000, error)
    const expectation = expect(result).rejects.toMatchObject({
      message: '抖音主页加载超时', code: 'DOUYIN_LOAD_TIMEOUT'
    })

    await vi.advanceTimersByTimeAsync(30_000)
    await expectation
    vi.useRealTimers()
  })
})
