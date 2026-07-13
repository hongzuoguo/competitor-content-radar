import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const DEFAULT_RETENTION_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export interface MediaCleanupOptions {
  retentionDays: number
  eligiblePaths: ReadonlySet<string>
  protectedPaths: ReadonlySet<string>
  protectedDirectories?: ReadonlySet<string>
  protectedWorkIds?: ReadonlySet<string>
}

interface MediaCleanupRecords {
  retentionDays: unknown
  works: ReadonlyArray<{ id: string; mediaPath: string | null }>
  jobs: ReadonlyArray<{ workId: string; status: 'pending' | 'running' | 'completed' | 'failed' }>
  artifacts: ReadonlyArray<{ workId: string; wavPath: string | null }>
}

export function createMediaCleanupOptions(records: MediaCleanupRecords): MediaCleanupOptions {
  const pathsByWork = new Map<string, string[]>()
  for (const work of records.works) {
    if (work.mediaPath) pathsByWork.set(work.id, [work.mediaPath])
  }
  for (const artifact of records.artifacts) {
    if (!artifact.wavPath) continue
    pathsByWork.set(artifact.workId, [...(pathsByWork.get(artifact.workId) ?? []), artifact.wavPath])
  }
  const eligiblePaths = new Set<string>()
  const protectedPaths = new Set<string>()
  const protectedDirectories = new Set<string>()
  const protectedWorkIds = new Set<string>()
  for (const job of records.jobs) {
    const paths = pathsByWork.get(job.workId) ?? []
    if (job.status === 'completed' || job.status === 'failed') {
      for (const path of paths) eligiblePaths.add(path)
    } else {
      protectedWorkIds.add(job.workId)
      for (const path of paths) {
        protectedPaths.add(path)
        protectedDirectories.add(dirname(path))
      }
    }
  }
  return {
    retentionDays: normalizeMediaRetentionDays(records.retentionDays),
    eligiblePaths,
    protectedPaths,
    protectedDirectories,
    protectedWorkIds
  }
}

export function normalizeMediaRetentionDays(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : DEFAULT_RETENTION_DAYS
}

export function cleanupExpiredMedia(
  directory: string,
  optionsOrNow: MediaCleanupOptions | Date = new Date(),
  requestedNow = new Date()
): string[] {
  const removed: string[] = []
  const root = resolve(directory)
  const legacy = optionsOrNow instanceof Date
  const options = legacy ? null : optionsOrNow
  const now = legacy ? optionsOrNow : requestedNow
  const retentionMs = normalizeMediaRetentionDays(options?.retentionDays) * DAY_MS
  const eligible = options ? normalizeManagedPaths(root, options.eligiblePaths) : null
  const protectedPaths = options ? normalizeManagedPaths(root, options.protectedPaths) : new Set<string>()
  const protectedDirectories = options
    ? normalizeManagedPaths(root, options.protectedDirectories ?? new Set())
    : new Set<string>()
  const protectedDirectoryNames = new Set(
    [...(options?.protectedWorkIds ?? [])].map((workId) => workId.replaceAll(':', '_'))
  )

  function visit(current: string): boolean {
    if (protectedDirectories.has(current)) return false
    let names: string[]
    try {
      names = readdirSync(current)
    } catch {
      return false
    }
    let removedInTree = false
    for (const name of names) {
      const path = resolve(join(current, name))
      if (!isWithinRoot(root, path)) continue
      try {
        const details = lstatSync(path)
        if (details.isSymbolicLink()) continue
        if (details.isDirectory()) {
          if (current === root && protectedDirectoryNames.has(name)) continue
          const removedBelow = visit(path)
          if (removedBelow && readdirSync(path).length === 0) rmdirSync(path)
          removedInTree ||= removedBelow
        } else if (
          !protectedPaths.has(path) &&
          (eligible === null || eligible.has(path)) &&
          now.getTime() - details.mtimeMs >= retentionMs
        ) {
          unlinkSync(path)
          removed.push(path)
          removedInTree = true
        }
      } catch {
        // A locked or concurrently removed file must not abort cleanup.
      }
    }
    return removedInTree
  }

  visit(root)
  return removed
}

function normalizeManagedPaths(root: string, paths: ReadonlySet<string>): Set<string> {
  const normalized = new Set<string>()
  for (const path of paths) {
    const candidate = resolve(path)
    if (isWithinRoot(root, candidate)) normalized.add(candidate)
  }
  return normalized
}

function isWithinRoot(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder)
}
