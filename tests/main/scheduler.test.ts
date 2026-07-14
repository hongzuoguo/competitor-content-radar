import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppScheduler, nextDailyRun, nextWeeklyRun, shouldRunCatchUp } from '../../src/main/scheduler'

afterEach(() => vi.useRealTimers())

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

  it('retries a daily run that was rejected because another run is active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T23:59:59.000Z'))
    const runDaily = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const scheduler = new AppScheduler(runDaily, vi.fn(async () => true))

    scheduler.start(new Date('2026-07-10T00:00:00.000Z'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(runDaily).toHaveBeenNthCalledWith(1, 'daily')

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    expect(runDaily).toHaveBeenNthCalledWith(2, 'catch_up')
    scheduler.stop()
  })

  it('safely schedules the next weekly run after the current one rejects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
    const runWeekly = vi.fn()
      .mockRejectedValueOnce(new Error('weekly rejected'))
      .mockResolvedValueOnce(true)
    const scheduler = new AppScheduler(vi.fn(async () => true), runWeekly)

    scheduler.start(new Date('2026-07-11T00:00:00.000Z'))
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1_000 + 90 * 60 * 1_000)
    expect(runWeekly).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1_000)
    expect(runWeekly).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})
