import { describe, expect, it } from 'vitest'
import { retryDelayMs } from '../../src/services/pipeline/retry-policy'

describe('pipeline retry policy', () => {
  it('uses the confirmed 1, 5 and 15 minute retry schedule', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(5 * 60_000)
    expect(retryDelayMs(3)).toBe(15 * 60_000)
    expect(retryDelayMs(4)).toBeNull()
  })

  it('honors a larger Retry-After value', () => {
    expect(retryDelayMs(1, 180)).toBe(180_000)
  })
})
