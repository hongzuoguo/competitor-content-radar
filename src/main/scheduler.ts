const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000

function chinaParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(date.getTime() + CHINA_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay()
  }
}

function chinaTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date {
  return new Date(Date.UTC(year, month, day, hour - 8, minute))
}

export function nextDailyRun(now: Date): Date {
  const parts = chinaParts(now)
  const today = chinaTime(parts.year, parts.month, parts.day, 9)
  return today > now ? today : chinaTime(parts.year, parts.month, parts.day + 1, 9)
}

export function nextWeeklyRun(now: Date): Date {
  const parts = chinaParts(now)
  const daysUntilMonday = (8 - parts.weekday) % 7
  const candidate = chinaTime(parts.year, parts.month, parts.day + daysUntilMonday, 9, 30)
  return candidate > now
    ? candidate
    : chinaTime(parts.year, parts.month, parts.day + daysUntilMonday + 7, 9, 30)
}

export function shouldRunCatchUp(
  lastDailyCompletedAt: Date | null,
  now: Date,
  catchUpAlreadyStarted: boolean
): boolean {
  if (catchUpAlreadyStarted) return false
  const parts = chinaParts(now)
  const todaySchedule = chinaTime(parts.year, parts.month, parts.day, 9)
  const latestExpected = now >= todaySchedule
    ? todaySchedule
    : chinaTime(parts.year, parts.month, parts.day - 1, 9)
  return !lastDailyCompletedAt || lastDailyCompletedAt < latestExpected
}

export class AppScheduler {
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly runDaily: (kind: 'daily' | 'catch_up') => Promise<void>,
    private readonly runWeekly: () => Promise<void>
  ) {}

  start(lastDailyCompletedAt: Date | null): void {
    this.stop()
    const now = new Date()
    if (shouldRunCatchUp(lastDailyCompletedAt, now, false)) void this.runDaily('catch_up')
    this.scheduleDaily()
    this.scheduleWeekly()
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  private scheduleDaily(): void {
    const delay = nextDailyRun(new Date()).getTime() - Date.now()
    const timer = setTimeout(() => {
      void this.runDaily('daily').finally(() => this.scheduleDaily())
    }, delay)
    this.timers.push(timer)
  }

  private scheduleWeekly(): void {
    const delay = nextWeeklyRun(new Date()).getTime() - Date.now()
    const timer = setTimeout(() => {
      void this.runWeekly().finally(() => this.scheduleWeekly())
    }, delay)
    this.timers.push(timer)
  }
}
