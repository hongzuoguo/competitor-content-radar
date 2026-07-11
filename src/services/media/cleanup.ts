import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function cleanupExpiredMedia(directory: string, now = new Date()): string[] {
  const removed: string[] = []

  function visit(current: string): void {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const details = lstatSync(path)
      if (details.isSymbolicLink()) continue
      if (details.isDirectory()) {
        visit(path)
        if (readdirSync(path).length === 0) rmdirSync(path)
      } else if (now.getTime() - details.mtimeMs >= RETENTION_MS) {
        unlinkSync(path)
        removed.push(path)
      }
    }
  }

  visit(directory)
  return removed
}
