import { lstat, realpath, rm, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SAFE_WORK_ID = /^[A-Za-z0-9_-]+$/

export interface RemoveWorkDirectoryDependencies {
  lstat(path: string): Promise<Stats>
  realpath(path: string): Promise<string>
  stat(path: string): Promise<Stats>
  rm(path: string, options: { recursive: true, force: true }): Promise<void>
}

const defaultDependencies: RemoveWorkDirectoryDependencies = { lstat, realpath, stat, rm }

export class ManagedWorkDirectoryError extends Error {
  constructor(readonly code: 'INVALID_FAILED_WORK_ID' | 'UNSAFE_MANAGED_WORK_PATH', cause?: unknown) {
    super(code === 'INVALID_FAILED_WORK_ID' ? 'Invalid failed work identifier.' : 'Managed work storage is unsafe.', { cause })
    this.name = 'ManagedWorkDirectoryError'
  }
}

export async function removeManagedWorkDirectory(
  mediaRoot: string,
  workId: string,
  dependencies: RemoveWorkDirectoryDependencies = defaultDependencies
): Promise<void> {
  if (!SAFE_WORK_ID.test(workId)) throw new ManagedWorkDirectoryError('INVALID_FAILED_WORK_ID')

  const root = resolve(mediaRoot)
  const candidate = resolve(root, workId)
  if (candidate === root || dirname(candidate) !== root) {
    throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
  }

  try {
    const rootIdentity = await inspectDirectory(dependencies, root)
    if (rootIdentity.realPath !== normalizePath(root)) throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')

    let candidateIdentity: DirectoryIdentity
    try {
      candidateIdentity = await inspectDirectory(dependencies, candidate)
    } catch (error) {
      if (isMissing(error)) {
        const confirmedRoot = await inspectDirectory(dependencies, root)
        if (!sameIdentity(rootIdentity, confirmedRoot) || confirmedRoot.realPath !== rootIdentity.realPath) {
          throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
        }
        return
      }
      throw error
    }
    if (candidateIdentity.realPath !== normalizePath(candidate) || dirname(candidateIdentity.realPath) !== rootIdentity.realPath) {
      throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
    }

    const confirmedRoot = await inspectDirectory(dependencies, root)
    const confirmedCandidate = await inspectDirectory(dependencies, candidate)
    if (!sameIdentity(rootIdentity, confirmedRoot) || !sameIdentity(candidateIdentity, confirmedCandidate) ||
      confirmedRoot.realPath !== rootIdentity.realPath || confirmedCandidate.realPath !== candidateIdentity.realPath) {
      throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
    }

    await dependencies.rm(candidate, { recursive: true, force: true })
  } catch (error) {
    if (error instanceof ManagedWorkDirectoryError) throw error
    throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH', error)
  }
}

interface DirectoryIdentity {
  dev: number | bigint
  ino: number | bigint
  realPath: string
}

async function inspectDirectory(
  dependencies: RemoveWorkDirectoryDependencies,
  path: string
): Promise<DirectoryIdentity> {
  const linkStats = await dependencies.lstat(path)
  if (linkStats.isSymbolicLink() || !linkStats.isDirectory()) {
    throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
  }
  const resolved = await dependencies.realpath(path)
  const targetStats = await dependencies.stat(resolved)
  if (!targetStats.isDirectory() || linkStats.dev !== targetStats.dev || linkStats.ino !== targetStats.ino) {
    throw new ManagedWorkDirectoryError('UNSAFE_MANAGED_WORK_PATH')
  }
  return { dev: linkStats.dev, ino: linkStats.ino, realPath: normalizePath(resolved) }
}

function sameIdentity(first: DirectoryIdentity, second: DirectoryIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino
}

function normalizePath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
