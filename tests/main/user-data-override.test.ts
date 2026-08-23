import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUserDataOverride } from '../../src/main/user-data-override'

const ISOLATED_TEST_DATA_ROOT = 'E:\\10500\\radar-test'

async function withFixture(test: (fixture: string) => Promise<void>): Promise<void> {
  await mkdir(ISOLATED_TEST_DATA_ROOT, { recursive: true })
  const fixture = await mkdtemp(join(ISOLATED_TEST_DATA_ROOT, 'user-data-override-'))
  try {
    await test(fixture)
  } finally {
    await rm(fixture, { force: true, recursive: true, maxRetries: 3 })
  }
}

describe('resolveUserDataOverride', () => {
  it('returns null when no user-data override was provided', () => {
    expect(resolveUserDataOverride(['electron', 'main.js'])).toBeNull()
  })

  it('accepts an absolute strict descendant of the isolated test-data root', () => {
    expect(resolveUserDataOverride([
      'electron',
      '--hitmuse-user-data-dir=E:\\10500\\radar-test\\run-123',
    ])).toBe('E:\\10500\\radar-test\\run-123')
  })

  it('accepts the fixed persistent Electron Preview user-data directory', () => {
    expect(resolveUserDataOverride([
      'electron',
      '--hitmuse-user-data-dir=E:\\10500\\radar-preview\\user-data',
    ])).toBe('E:\\10500\\radar-preview\\user-data')
  })

  it('accepts the exact smoke user-data directory under an explicit ordinary test root', async () => {
    const testRoot = await mkdtemp(join('E:\\10500', 'hitmuse-explicit-test-root-'))
    const smokeRoot = join(testRoot, 'smoke-ci')
    const userData = join(smokeRoot, 'user-data')
    try {
      await mkdir(smokeRoot)

      expect(resolveUserDataOverride([
        `--hitmuse-user-data-dir=${userData}`,
        `--hitmuse-smoke-test-root=${testRoot}`,
      ])).toBe(userData)
    } finally {
      await rm(testRoot, { force: true, recursive: true, maxRetries: 3 })
    }
  })

  it('rejects an explicit smoke test root that is missing or not a directory', async () => {
    const fixture = await mkdtemp(join('E:\\10500', 'hitmuse-invalid-test-root-'))
    const missingRoot = join(fixture, 'missing')
    const fileRoot = join(fixture, 'file')
    await writeFile(fileRoot, 'not a directory')
    try {
      for (const testRoot of [missingRoot, fileRoot]) {
        expect(() => resolveUserDataOverride([
          `--hitmuse-user-data-dir=${join(testRoot, 'smoke-ci', 'user-data')}`,
          `--hitmuse-smoke-test-root=${testRoot}`,
        ])).toThrow('HITMUSE_SMOKE_TEST_ROOT_INVALID')
      }
    } finally {
      await rm(fixture, { force: true, recursive: true, maxRetries: 3 })
    }
  })

  it('accepts a descendant regardless of Windows path case and separators', () => {
    expect(resolveUserDataOverride([
      '--hitmuse-user-data-dir=e:/10500/RADAR-TEST/run-123',
    ])).toBe('e:\\10500\\RADAR-TEST\\run-123')
  })

  it('allows ordinary existing directories and descendants that do not exist yet', async () => {
    await withFixture(async (fixture) => {
      const existing = join(fixture, 'existing')
      const notCreatedYet = join(existing, 'not-created-yet')
      await mkdir(existing)

      expect(resolveUserDataOverride([
        `--hitmuse-user-data-dir=${existing}`,
      ])).toBe(existing)
      expect(resolveUserDataOverride([
        `--hitmuse-user-data-dir=${notCreatedYet}`,
      ])).toBe(notCreatedYet)
    })
  })

  it('rejects a junction used as an existing ancestor', async () => {
    await withFixture(async (fixture) => {
      const target = join(fixture, 'target')
      const junction = join(fixture, 'ancestor-junction')
      await mkdir(target)
      await symlink(target, junction, 'junction')

      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${join(junction, 'profile')}`,
      ])).toThrow('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    })
  })

  it('rejects a junction used as the override target', async () => {
    await withFixture(async (fixture) => {
      const target = join(fixture, 'target')
      const junction = join(fixture, 'target-junction')
      await mkdir(target)
      await symlink(target, junction, 'junction')

      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${junction}`,
      ])).toThrow('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    })
  })

  it('rejects a dangling junction used as an existing ancestor', async () => {
    await withFixture(async (fixture) => {
      const junction = join(fixture, 'dangling-ancestor-junction')
      await symlink(join(fixture, 'missing-target'), junction, 'junction')

      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${join(junction, 'profile')}`,
      ])).toThrow('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    })
  })

  it('rejects a dangling junction used as the override target', async () => {
    await withFixture(async (fixture) => {
      const junction = join(fixture, 'dangling-target-junction')
      await symlink(join(fixture, 'missing-target'), junction, 'junction')

      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${junction}`,
      ])).toThrow('HITMUSE_USER_DATA_REPARSE_POINT_NOT_ALLOWED')
    })
  })

  it('rejects an empty override', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_NOT_BE_EMPTY')
  })

  it('rejects a relative override with a stable error', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=radar-test\\run-123',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_ABSOLUTE')
  })

  it('rejects absolute forms that are not drive-qualified E: paths', () => {
    for (const path of [
      '\\10500\\radar-test\\run-123',
      '\\\\server\\share\\run-123',
      '\\\\?\\E:\\10500\\radar-test\\run-123',
    ]) {
      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${path}`,
      ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_ABSOLUTE')
    }
  })

  it('rejects the isolated test-data root itself', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=E:\\10500\\radar-test',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  })

  it('rejects a filesystem root', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=E:\\',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  })

  it('rejects a similar path prefix outside the test-data root', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=E:\\10500\\radar-test-backup\\run-123',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  })

  it('rejects a traversal that resolves outside the test-data root', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=E:\\10500\\radar-test\\..\\production',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  })

  it('rejects the production installation directories', () => {
    for (const path of [
      'C:\\Users\\10500\\AppData\\Local\\Programs\\HitMuse\\data',
      'C:\\Users\\10500\\AppData\\Local\\Programs\\HitMuse App\\data',
    ]) {
      expect(() => resolveUserDataOverride([
        `--hitmuse-user-data-dir=${path}`,
      ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
    }
  })

  it('rejects the production app-data directory', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=C:\\Users\\10500\\AppData\\Roaming\\HitMuse',
    ])).toThrow('HITMUSE_USER_DATA_PATH_MUST_BE_A_STRICT_DESCENDANT')
  })

  it('rejects repeated overrides to avoid ambiguity', () => {
    expect(() => resolveUserDataOverride([
      '--hitmuse-user-data-dir=E:\\10500\\radar-test\\run-123',
      '--hitmuse-user-data-dir=E:\\10500\\radar-test\\run-456',
    ])).toThrow('HITMUSE_USER_DATA_PATH_IS_AMBIGUOUS')
  })
})
