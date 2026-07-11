const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const

export function retryDelayMs(attempt: number, retryAfterSeconds?: number): number | null {
  const configured = RETRY_DELAYS_MS[attempt - 1]
  if (configured === undefined) return null
  return Math.max(configured, (retryAfterSeconds ?? 0) * 1000)
}
