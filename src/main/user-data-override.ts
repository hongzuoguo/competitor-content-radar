import { lstatSync, realpathSync } from 'node:fs'
import { win32 } from 'node:path'

const USER_DATA_OVERRIDE_PREFIX = '--hitmuse-user-data-dir='
const SMOKE_TEST_ROOT_PREFIX = '--hitmuse-smoke-test-root='
const ALLOWED_USER_DATA_ROOTS = [
  'E:\\10500\\radar-test',
  'E:\\10500\\radar-preview'
]
const DRIVE_QUALIFIED_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

function fail(code: string): never {
  throw new Error(code)
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isSameWindowsPath(left: string, right: string): boolean {
  return win32.relative(win32.resolve(left), win32.resolve(right)) === ''
}

function assertNoExistingReparsePoints(root: string, relative: string): void {
  const paths = [root]
  let current = root
  for (const segment of relative.split(win32.sep)) {
    current = win32.join(current, segment)
    paths.push(current)
  }

  for (const path of paths) {
    let stats
    try {
      stats = lstatSync(path)
    } catch (error) {
      if (isMissingPath(error)) return
      fail('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    }

    if (stats.isSymbolicLink()) fail('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')

    let realPath: string
    try {
      realPath = realpathSync.native(path)
    } catch {
      fail('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    }
    if (!isSameWindowsPath(path, realPath)) fail('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
  }
}

function assertExistingOrdinaryDirectory(path: string): void {
  try {
    const stats = lstatSync(path)
    if (!stats.isDirectory() || stats.isSymbolicLink() || !isSameWindowsPath(path, realpathSync.native(path))) {
      fail('HITMUSE_SMOKE_TEST_ROOT_INVALID')
    }
  } catch {
    fail('HITMUSE_SMOKE_TEST_ROOT_INVALID')
  }
}

export function resolveUserDataOverride(argv: readonly string[]): string | null {
  const overrides = argv
    .filter((argument) => argument.startsWith(USER_DATA_OVERRIDE_PREFIX))
    .map((argument) => argument.slice(USER_DATA_OVERRIDE_PREFIX.length))

  if (overrides.length === 0) return null
  if (overrides.length > 1) fail('HITMUSE_USER_DATA_PATH_IS_AMBIGUOUS')

  const override = overrides[0]
  if (override.trim().length === 0) fail('HITMUSE_USER_DATA_PATH_MUST_NOT_BE_EMPTY')
  if (!win32.isAbsolute(override) || !DRIVE_QUALIFIED_ABSOLUTE_PATH.test(override)) {
    fail('HITMUSE_USER_DATA_PATH_MUST_BE_ABSOLUTE')
  }

  const resolvedOverride = win32.resolve(override)
  const smokeTestRoots = argv
    .filter((argument) => argument.startsWith(SMOKE_TEST_ROOT_PREFIX))
    .map((argument) => argument.slice(SMOKE_TEST_ROOT_PREFIX.length))
  if (smokeTestRoots.length > 1) fail('HITMUSE_SMOKE_TEST_ROOT_IS_AMBIGUOUS')

  const explicitSmokeRoot = smokeTestRoots[0]
  if (explicitSmokeRoot !== undefined) {
    if (!win32.isAbsolute(explicitSmokeRoot) || !DRIVE_QUALIFIED_ABSOLUTE_PATH.test(explicitSmokeRoot)) {
      fail('HITMUSE_SMOKE_TEST_ROOT_MUST_BE_ABSOLUTE')
    }
    const root = win32.resolve(explicitSmokeRoot)
    assertExistingOrdinaryDirectory(root)
    const relative = win32.relative(root, resolvedOverride)
    const segments = relative.split(win32.sep)
    if (segments.length !== 2 || !segments[0].startsWith('smoke-') || segments[0] === 'smoke-' || segments[1] !== 'user-data') {
      fail('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
    }
    assertNoExistingReparsePoints(root, relative)
    return resolvedOverride
  }

  const match = ALLOWED_USER_DATA_ROOTS
    .map((allowedRoot) => {
      const root = win32.resolve(allowedRoot)
      return { root, relative: win32.relative(root, resolvedOverride) }
    })
    .find(({ relative }) => (
      relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${win32.sep}`) &&
      !win32.isAbsolute(relative)
    ))
  if (!match) {
    fail('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  }

  assertNoExistingReparsePoints(match.root, match.relative)

  return resolvedOverride
}
