import { describe, expect, it } from 'vitest'
import { nextDailyRun, nextWeeklyRun, shouldRunCatchUp } from '../../src/main/scheduler'

describe('China-time scheduler', () => {
  it('schedules the daily run at the next 08:00 China time', () => {
    expect(nextDailyRun(new Date('2026-07-11T00:30:00.000Z')).toISOString()).toBe(
      '2026-07-12T00:00:00.000Z'
    )
    expect(nextDailyRun(new Date('2026-07-11T02:00:00.000Z')).toISOString()).toBe(
      '2026-07-12T00:00:00.000Z'
    )
  })

  it('schedules the weekly run on Monday at 09:30 China time', () => {
    expect(nextWeeklyRun(new Date('2026-07-11T00:00:00.000Z')).toISOString()).toBe(
      '2026-07-13T01:30:00.000Z'
    )
  })

  it('requests only one catch-up after a missed daily run', () => {
    const now = new Date('2026-07-11T01:00:00.000Z')
    expect(shouldRunCatchUp(new Date('2026-07-10T00:00:00.000Z'), now, false)).toBe(true)
    expect(shouldRunCatchUp(new Date('2026-07-10T00:00:00.000Z'), now, true)).toBe(false)
    expect(shouldRunCatchUp(new Date('2026-07-11T00:00:00.000Z'), now, false)).toBe(false)
  })
})
