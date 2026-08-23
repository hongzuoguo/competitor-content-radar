import { randomUUID } from 'node:crypto'
import { lstat, link, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const SMOKE_RUNTIME_READINESS_FILE_PREFIX = '--hitmuse-smoke-runtime-readiness-file='
const SMOKE_RUNTIME_READINESS_FILENAME = 'runtime-readiness.json'
const SMOKE_RUNTIME_READINESS = '{"schemaVersion":1,"engine":"ready","model":"ready"}'

type SmokeRuntimeReadinessDependencies = {
  verify(): Promise<void>
}

function fail(code: string): never {
  throw new Error(code)
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

async function assertOrdinaryDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
  try {
    const metadata = await lstat(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(path), path)) {
      fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
    }
  } catch {
    fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
  }
}

async function assertMarkerAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  fail('HITMUSE_SMOKE_RUNTIME_READINESS_ALREADY_EXISTS')
}

export async function prepareSmokeRuntimeReadiness(
  argv: readonly string[],
  userDataDirectory: string,
  dependencies: SmokeRuntimeReadinessDependencies
): Promise<(() => Promise<void>) | null> {
  const matches = argv.filter((argument) => argument.startsWith(SMOKE_RUNTIME_READINESS_FILE_PREFIX))
  if (matches.length === 0) return null
  if (matches.length !== 1) fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
  const markerPath = matches[0].slice(SMOKE_RUNTIME_READINESS_FILE_PREFIX.length)
  const expectedPath = join(userDataDirectory, SMOKE_RUNTIME_READINESS_FILENAME)
  if (!isAbsolute(markerPath) || !samePath(markerPath, expectedPath)) {
    fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
  }
  await assertOrdinaryDirectory(userDataDirectory)
  await assertMarkerAbsent(expectedPath)
  await dependencies.verify()

  return async () => {
    await assertMarkerAbsent(expectedPath)
    const temporaryPath = join(userDataDirectory, `.runtime-readiness-${process.pid}-${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, SMOKE_RUNTIME_READINESS, { encoding: 'utf8', flag: 'wx' })
      await link(temporaryPath, expectedPath)
      const marker = await lstat(expectedPath)
      if (!marker.isFile() || marker.isSymbolicLink() || !samePath(await realpath(expectedPath), expectedPath)) {
        fail('HITMUSE_SMOKE_RUNTIME_READINESS_PATH_INVALID')
      }
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}
