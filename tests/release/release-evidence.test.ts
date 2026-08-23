import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { generateReleaseEvidence } from '../../scripts/generate-release-evidence.mjs'

const commit = 'a'.repeat(40)
const execFileAsync = promisify(execFile)
const releaseEvidenceModule = pathToFileURL(resolve(process.cwd(), 'scripts/generate-release-evidence.mjs')).href

async function withFixture(run: (source: string, output: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-release-evidence-'))
  const source = join(root, 'source')
  const output = join(root, 'output')
  await mkdir(join(source, 'docs'), { recursive: true })
  await mkdir(join(source, 'guides'), { recursive: true })
  const installer = 'installer'
  const installerSha512 = createHash('sha512').update(installer).digest('base64')
  await writeFile(join(source, 'latest.yml'), [
    'version: 1.0.5',
    'files:',
    '  - url: competitor-content-radar-setup-1.0.5.exe',
    `    sha512: ${installerSha512}`,
    `    size: ${Buffer.byteLength(installer)}`,
    'path: competitor-content-radar-setup-1.0.5.exe',
    `sha512: ${installerSha512}`,
    'releaseDate: 2026-08-23T00:00:00.000Z',
    ''
  ].join('\n'))
  await writeFile(join(source, 'HitMuse-1.0.5-aaaaaaa-setup.exe'), installer)
  await writeFile(join(source, 'HitMuse-1.0.5-aaaaaaa-setup.exe.blockmap'), 'blockmap')
  await writeFile(join(source, 'engine-manifest.json'), '{}')
  await writeFile(join(source, 'engine-provenance.json'), '{}')
  await writeFile(join(source, 'THIRD_PARTY_NOTICES.md'), 'notices')
  await writeFile(join(source, 'docs', 'resources-and-licenses.md'), 'licenses')
  await writeFile(join(source, 'guides', 'competitor-content-radar-user-guide.md'), 'guide')
  await writeFile(join(source, 'guides', 'competitor-content-radar-user-guide.docx'), 'guide-docx')
  try {
    await run(source, output)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('release evidence', () => {
  it('writes a sorted commit-bound public inventory without host paths', async () => {
    await withFixture(async (source, output) => {
      const result = await generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' })
      expect(result.files.map((file) => file.path)).toEqual([...result.files.map((file) => file.path)].sort())
      expect(result.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'latest.yml' }),
        expect.objectContaining({ path: 'HitMuse-1.0.5-aaaaaaa-setup.exe' }),
        expect.objectContaining({ path: 'HitMuse-1.0.5-aaaaaaa-setup.exe.blockmap' }),
        expect.objectContaining({ path: 'SHA256SUMS.txt' }),
        expect.objectContaining({ path: 'checksums.json' }),
        expect.objectContaining({ path: 'build-manifest.json' }),
        expect.objectContaining({ path: 'acceptance.log' }),
        expect.objectContaining({ path: 'engine-manifest.json' }),
        expect.objectContaining({ path: 'engine-provenance.json' }),
        expect.objectContaining({ path: 'THIRD_PARTY_NOTICES.md' }),
        expect.objectContaining({ path: 'docs/resources-and-licenses.md' }),
        expect.objectContaining({ path: 'guides/competitor-content-radar-user-guide.md' }),
        expect.objectContaining({ path: 'guides/competitor-content-radar-user-guide.docx' })
      ]))
      const checksums = JSON.parse(await readFile(join(output, 'checksums.json'), 'utf8'))
      expect(checksums.commit).toBe(commit)
      expect(checksums.files.map((file: { path: string }) => file.path)).toEqual(result.files.map((file) => file.path))
      expect(result.files).toEqual(checksums.files)
      expect(checksums.files.find((file: { path: string }) => file.path === 'checksums.json')).toEqual({
        path: 'checksums.json', sha256: null, bytes: expect.any(Number), status: 'SELF_EXCLUDED'
      })
      expect(checksums.selfHashConvention).toContain('intentionally omits its SHA-256')
      expect(checksums.files.find((file: { path: string }) => file.path === 'checksums.json').bytes)
        .toBe(Buffer.byteLength(await readFile(join(output, 'checksums.json'), 'utf8'), 'utf8'))
      const assetsManifest = JSON.parse(await readFile(join(output, 'assets-manifest.json'), 'utf8'))
      expect(assetsManifest).toEqual({
        schemaVersion: 1,
        commit,
        version: '1.0.5',
        assets: expect.arrayContaining([
          expect.objectContaining({ name: 'checksums.json', bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
          expect.objectContaining({ name: 'latest.yml', bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
        ])
      })
      expect(assetsManifest.assets.every((file: { name: string, bytes: number, sha256: string }) => file.name === file.name.split('/').at(-1) && file.bytes >= 0 && /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
      expect(assetsManifest.assets.some((file: { name: string }) => file.name === 'assets-manifest.json')).toBe(false)
      expect(checksums.files.filter((file: { path: string }) => file.path !== 'checksums.json').every((file: { sha256: string; bytes: number; status: string }) => (
        /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes >= 0 && ['VERIFIED', 'GENERATED'].includes(file.status)
      ))).toBe(true)
      expect(JSON.stringify(checksums)).not.toContain(source)
      expect(JSON.stringify(checksums)).not.toContain(output)
      const lines = (await readFile(join(output, 'SHA256SUMS.txt'), 'utf8')).split('\n').filter(Boolean)
      expect(lines).toEqual([...lines].sort())
      expect(lines.some((line) => line.endsWith('  checksums.json'))).toBe(false)
      expect(result.files.filter((file) => file.path !== 'checksums.json').every((file) => (
        /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes >= 0
      ))).toBe(true)
      const latest = await readFile(join(output, 'latest.yml'), 'utf8')
      expect(latest).toContain('path: HitMuse-1.0.5-aaaaaaa-setup.exe')
      expect(latest).toContain('url: HitMuse-1.0.5-aaaaaaa-setup.exe')
      expect(latest).not.toContain('competitor-content-radar-setup-1.0.5.exe')
      expect(await readFile(join(output, 'HitMuse-1.0.5-aaaaaaa-setup.exe.blockmap'), 'utf8')).toBe('blockmap')
      expect(checksums.files.find((file: { path: string }) => file.path === 'latest.yml')?.sha256)
        .toBe(createHash('sha256').update(latest).digest('hex'))
    })
  })

  it('refuses an unexpected or missing release asset before writing output', async () => {
    await withFixture(async (source, output) => {
      await writeFile(join(source, 'secret.txt'), createHash('sha256').digest('hex'))
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
      expect(existsSync(output)).toBe(false)

      await rm(join(source, 'secret.txt'))
      await unlink(join(source, 'latest.yml'))
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
      expect(existsSync(output)).toBe(false)
    })
  })

  it('requires absolute, disjoint, non-overwriting paths and an exact commit', async () => {
    await withFixture(async (source, output) => {
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: join(source, 'evidence'), commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_PATH_INVALID')
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: join(process.cwd(), 'release-evidence-output'), commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_PATH_INVALID')
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit: 'abc', version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_OPTIONS_INVALID')
      await mkdir(output)
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_OUTPUT_EXISTS')
    })
  })

  it('protects the script repository when invoked from an unrelated working directory', async () => {
    await withFixture(async (source) => {
      const executionDirectory = join(dirname(source), 'execution')
      await mkdir(executionDirectory)
      const probe = [
        `import { generateReleaseEvidence } from ${JSON.stringify(releaseEvidenceModule)}`,
        `await generateReleaseEvidence({ sourceRoot: ${JSON.stringify(source)}, outputRoot: ${JSON.stringify(process.cwd())}, commit: ${JSON.stringify(commit)}, version: '1.0.5' })`
      ].join('; ')

      await expect(execFileAsync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: executionDirectory, windowsHide: true
      })).rejects.toMatchObject({ stderr: expect.stringContaining('RELEASE_EVIDENCE_PATH_INVALID') })
    })
  })

  it('rejects missing notices and reparse-point assets', async () => {
    await withFixture(async (source, output) => {
      await unlink(join(source, 'THIRD_PARTY_NOTICES.md'))
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
    })

    await withFixture(async (source, output) => {
      await unlink(join(source, 'docs', 'resources-and-licenses.md'))
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
    })

    await withFixture(async (source, output) => {
      await symlink(join(source, 'guides'), join(source, 'linked-guides'), 'junction')
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
    })
  })

  it('rejects public-guide names outside the finite release allowlist', async () => {
    await withFixture(async (source, output) => {
      await writeFile(join(source, 'guides', 'secret.md'), 'not public')
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_ASSET_INVALID')
    })
  })

  it.each([
    ['a wrong sha512', (latest: string) => latest.replace(/sha512: .+/, `sha512: ${'a'.repeat(88)}`)],
    ['a wrong installer size', (latest: string) => latest.replace(/size: \d+/, 'size: 999')],
    ['an unexpected installer name', (latest: string) => latest.replace('path: competitor-content-radar-setup-1.0.5.exe', 'path: extra-installer.exe')],
    ['multiple installer URLs', (latest: string) => latest.replace('path: competitor-content-radar-setup-1.0.5.exe', '  - url: extra-installer.exe\npath: competitor-content-radar-setup-1.0.5.exe')]
  ])('rejects updater metadata with %s before writing output', async (_name, alter) => {
    await withFixture(async (source, output) => {
      const latestPath = join(source, 'latest.yml')
      await writeFile(latestPath, alter(await readFile(latestPath, 'utf8')), 'utf8')
      await expect(generateReleaseEvidence({ sourceRoot: source, outputRoot: output, commit, version: '1.0.5' }))
        .rejects.toThrow('RELEASE_EVIDENCE_UPDATER_INVALID')
      expect(existsSync(output)).toBe(false)
    })
  })
})
