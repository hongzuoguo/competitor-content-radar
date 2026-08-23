import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve('scripts/build-scrapling-engine.mjs')
const archive = Buffer.from('sidecar')
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-sidecar-'))
  temporaryRoots.push(root)
  return root
}

async function load() {
  return import(`${pathToFileURL(scriptPath).href}?test=${Date.now()}-${Math.random()}`)
}

async function writeFixture(root: string, mutate: (value: any) => void = () => {}) {
  const inputs: Record<string, string> = {
    'package.json': JSON.stringify({ version: '1.0.5' }),
    'scripts/build-scrapling-engine.mjs': 'builder\n',
    'engine/scrapling/requirements.txt': 'scrapling[fetchers]==0.4.11\npyinstaller==6.14.2\n',
    'engine/scrapling/requirements.lock.txt': 'scrapling==0.4.11 --hash=sha256:' + 'b'.repeat(64) + '\n',
    'engine/scrapling/setup-dev.ps1': 'setup\n',
    'engine/scrapling/build.ps1': 'build\n',
    'engine/scrapling/scrapling_engine.py': 'source\n',
    'engine/scrapling/protocol-v1.schema.json': '{}\n',
    'engine/scrapling/protocol-v1-vectors.json': '[]\n',
    'engine/scrapling/tests/test_engine.py': 'test\n',
    'resources/build-toolchain.json': JSON.stringify({ python: '3.12.10', pipTools: { version: '7.6.0' } })
  }
  for (const [path, value] of Object.entries(inputs)) {
    await mkdir(resolve(root, path, '..'), { recursive: true })
    await writeFile(resolve(root, path), value)
  }
  execFileSync('git.exe', ['init'], { cwd: root })
  execFileSync('git.exe', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  execFileSync('git.exe', ['config', 'user.name', 'Fixture'], { cwd: root })
  execFileSync('git.exe', ['add', '.'], { cwd: root })
  execFileSync('git.exe', ['commit', '-m', 'fixture'], { cwd: root })
  const sourceCommit = execFileSync('git.exe', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const sourceDateEpoch = Number(execFileSync('git.exe', ['show', '-s', '--format=%ct', sourceCommit], { cwd: root, encoding: 'utf8' }).trim())
  const archiveRoot = join(root, '.build-resources', 'scrapling-engine')
  await mkdir(archiveRoot, { recursive: true })
  await writeFile(join(archiveRoot, 'scrapling-engine-win32-x64.zip'), archive)
  const inputHashes = Object.fromEntries(Object.entries(inputs).map(([path, value]) => [path, hash(value)]))
  const manifest = { protocolVersion: 1, version: '1.0.5', platform: 'win32', arch: 'x64', archive: { filename: 'scrapling-engine-win32-x64.zip', size: archive.length, sha256: hash(archive) }, sourceCommit, pythonLockSha256: inputHashes['engine/scrapling/requirements.lock.txt'] }
  const provenance = { sourceCommit, package: { version: '1.0.5', python: '3.12.10', pipTools: '7.6.0', pyInstaller: '6.14.2', scrapling: '0.4.11' }, inputs: inputHashes, archive: manifest.archive, result: { pythonTests: 'passed', build: 'passed', sourceDateEpoch } }
  const value = { manifest, provenance }
  mutate(value)
  await writeFile(join(archiveRoot, 'engine-manifest.json'), JSON.stringify(value.manifest))
  await writeFile(join(archiveRoot, 'engine-provenance.json'), JSON.stringify(value.provenance))
  return { sourceCommit, archiveRoot }
}

afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('generated Scrapling sidecar', () => {
  it('requires the complete tracked input hash map', async () => {
    const root = await temporaryRoot()
    const { sourceCommit } = await writeFixture(root)
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).resolves.toMatchObject({ sourceCommit })
  })

  it.each([
    ['an extra nested field', (v: any) => { v.provenance.package.path = 'C:\\private' }],
    ['a leading-zero version', (v: any) => { v.manifest.version = '01.2.3' }],
    ['an oversized archive', (v: any) => { v.manifest.archive.size = 500_000_001 }],
    ['a package version mismatch', (v: any) => { v.provenance.package.version = '1.0.4' }],
    ['an omitted provenance input', (v: any) => { delete v.provenance.inputs['engine/scrapling/tests/test_engine.py'] }]
  ])('rejects %s', async (_label, mutate) => {
    const root = await temporaryRoot()
    const { sourceCommit } = await writeFixture(root, mutate)
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow(/SCRAPLING_SIDECAR_(MANIFEST|PROVENANCE)_INVALID/)
  })

  it.each(['setuptools>=42.0.0', 'setuptools', 'setuptools @ https://example.invalid/setuptools.whl', 'setuptools!=84.0.0'])('rejects every non-exact lock declaration: %s', async (declaration) => {
    const root = await temporaryRoot(); const { sourceCommit, archiveRoot } = await writeFixture(root)
    const lockPath = join(root, 'engine', 'scrapling', 'requirements.lock.txt')
    const lock = (await readFile(lockPath, 'utf8')) + declaration + '\n'
    await writeFile(lockPath, lock)
    const provenance = JSON.parse(await readFile(join(archiveRoot, 'engine-provenance.json'), 'utf8'))
    provenance.inputs['engine/scrapling/requirements.lock.txt'] = hash(lock)
    await writeFile(join(archiveRoot, 'engine-provenance.json'), JSON.stringify(provenance))
    const manifest = JSON.parse(await readFile(join(archiveRoot, 'engine-manifest.json'), 'utf8'))
    manifest.pythonLockSha256 = hash(lock)
    await writeFile(join(archiveRoot, 'engine-manifest.json'), JSON.stringify(manifest))
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_LOCK_INVALID')
  })

  it.each(['--requirement extra.txt', '--requirement=extra.txt', '-r extra.txt'])('rejects a top-level lock directive: %s', async (directive) => {
    const root = await temporaryRoot(); const { sourceCommit, archiveRoot } = await writeFixture(root)
    const lockPath = join(root, 'engine', 'scrapling', 'requirements.lock.txt')
    const lock = (await readFile(lockPath, 'utf8')) + directive + '\n'
    await writeFile(lockPath, lock)
    const provenance = JSON.parse(await readFile(join(archiveRoot, 'engine-provenance.json'), 'utf8'))
    provenance.inputs['engine/scrapling/requirements.lock.txt'] = hash(lock)
    const manifest = JSON.parse(await readFile(join(archiveRoot, 'engine-manifest.json'), 'utf8'))
    manifest.pythonLockSha256 = hash(lock)
    await Promise.all([writeFile(join(archiveRoot, 'engine-provenance.json'), JSON.stringify(provenance)), writeFile(join(archiveRoot, 'engine-manifest.json'), JSON.stringify(manifest))])
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_LOCK_INVALID')
  })

  it('rejects an indented declaration hidden after a valid hash continuation', async () => {
    const root = await temporaryRoot(); const { sourceCommit, archiveRoot } = await writeFixture(root)
    const lockPath = join(root, 'engine', 'scrapling', 'requirements.lock.txt')
    const lock = (await readFile(lockPath, 'utf8')) + '    setuptools>=42.0.0\n'
    await writeFile(lockPath, lock)
    const provenance = JSON.parse(await readFile(join(archiveRoot, 'engine-provenance.json'), 'utf8'))
    provenance.inputs['engine/scrapling/requirements.lock.txt'] = hash(lock)
    const manifest = JSON.parse(await readFile(join(archiveRoot, 'engine-manifest.json'), 'utf8'))
    manifest.pythonLockSha256 = hash(lock)
    await Promise.all([writeFile(join(archiveRoot, 'engine-provenance.json'), JSON.stringify(provenance)), writeFile(join(archiveRoot, 'engine-manifest.json'), JSON.stringify(manifest))])
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_LOCK_INVALID')
  })

  it('rejects a forged source date epoch', async () => {
    const root = await temporaryRoot(); const { sourceCommit } = await writeFixture(root, (v) => { v.provenance.result.sourceDateEpoch = 1 })
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  })

  it('accepts a valid provenance package with reordered keys', async () => {
    const root = await temporaryRoot(); const { sourceCommit } = await writeFixture(root, (v) => { v.provenance.package = { scrapling: '0.4.11', version: '1.0.5', pyInstaller: '6.14.2', pipTools: '7.6.0', python: '3.12.10' } })
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).resolves.toMatchObject({ sourceCommit })
  })

  it('rejects a manifest leaf reparse point', async () => {
    const root = await temporaryRoot(); const { sourceCommit, archiveRoot } = await writeFixture(root)
    const manifest = join(archiveRoot, 'engine-manifest.json'); const target = join(root, 'manifest-target.json')
    await rename(manifest, target)
    try { await symlink(target, manifest, 'file') } catch (error: any) { if (error?.code === 'EPERM') return; throw error }
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_REPARSE_POINT')
  })

  it('rejects a manifest leaf that is a directory', async () => {
    const root = await temporaryRoot(); const { sourceCommit, archiveRoot } = await writeFixture(root)
    const manifest = join(archiveRoot, 'engine-manifest.json')
    await rename(manifest, join(root, 'manifest-target.json')); await mkdir(manifest)
    const module = await load()
    await expect(module.verifyGeneratedScraplingResource({ rootDirectory: root, sourceCommit })).rejects.toThrow('SCRAPLING_SIDECAR_REPARSE_POINT')
  })

  it('rolls back the old final directory when promotion fails', async () => {
    const root = await temporaryRoot()
    const final = join(root, 'final')
    const stage = join(root, 'stage')
    const previous = join(root, 'previous')
    await mkdir(final); await mkdir(stage)
    await writeFile(join(final, 'old.txt'), 'old')
    await writeFile(join(stage, 'new.txt'), 'new')
    const module = await load()
    const renameFile = async (from: string, to: string) => {
      if (from === stage && to === final) throw Object.assign(new Error('PROMOTE_FAIL'), { code: 'EIO' })
      await rename(from, to)
    }
    await expect(module.promoteScraplingStage({ stage, final, previous, renameFile })).rejects.toThrow('PROMOTE_FAIL')
    await expect(readFile(join(final, 'old.txt'), 'utf8')).resolves.toBe('old')
    expect(existsSync(stage)).toBe(true)
  })

  it('retains the backup and exposes a stable error when rollback fails', async () => {
    const root = await temporaryRoot()
    const final = join(root, 'final'); const stage = join(root, 'stage'); const previous = join(root, 'previous')
    await mkdir(final); await mkdir(stage); await writeFile(join(final, 'old.txt'), 'old')
    const module = await load()
    const renameFile = async (from: string, to: string) => {
      if (from === stage && to === final) throw Object.assign(new Error('PROMOTE_FAIL'), { code: 'EIO' })
      if (from === previous && to === final) throw Object.assign(new Error('ROLLBACK_FAIL'), { code: 'EIO' })
      await rename(from, to)
    }
    await expect(module.promoteScraplingStage({ stage, final, previous, renameFile })).rejects.toThrow('SCRAPLING_PROMOTION_ROLLBACK_FAILED')
    await expect(readFile(join(previous, 'old.txt'), 'utf8')).resolves.toBe('old')
  })

  it('uses deterministic .NET ZipArchive settings and reparse validation in both PowerShell entry points', async () => {
    const [build, setup] = await Promise.all([readFile(resolve('engine/scrapling/build.ps1'), 'utf8'), readFile(resolve('engine/scrapling/setup-dev.ps1'), 'utf8')])
    expect(build).toContain('System.IO.Compression.ZipArchive')
    expect(build).toContain('Add-Type -AssemblyName System.IO.Compression')
    expect(build).toContain('New-Object -TypeName System.IO.Compression.ZipArchive')
    expect(build).toContain('LastWriteTime')
    expect(build).toContain('SOURCE_DATE_EPOCH')
    expect(build).toContain('Sort-Object')
    expect(setup).toContain('Assert-OrdinaryPath $Root')
    expect(setup).toContain('Assert-OrdinaryPath $Venv')
    expect(setup).toContain('Assert-OrdinaryPath $Python')
  })

  it('clears the task-owned virtual environment before installing the hash lock', async () => {
    const setup = await readFile(resolve('engine/scrapling/setup-dev.ps1'), 'utf8')
    const recreate = setup.indexOf('py -3.12 -m venv --clear $Venv')
    const install = setup.indexOf('$Python -m pip install --require-hashes -r $Lock')

    expect(recreate).toBeGreaterThanOrEqual(0)
    expect(recreate).toBeLessThan(install)
  })
})
