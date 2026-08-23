import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(scriptPath), '..')
const engineRoot = join(projectRoot, 'engine', 'scrapling')
const outputParent = join(projectRoot, '.build-resources')
const archiveName = 'scrapling-engine-win32-x64.zip'
export const sidecarBuildInputs = ['package.json', 'scripts/build-scrapling-engine.mjs', 'engine/scrapling/requirements.txt', 'engine/scrapling/requirements.lock.txt', 'engine/scrapling/setup-dev.ps1', 'engine/scrapling/build.ps1', 'engine/scrapling/scrapling_engine.py', 'engine/scrapling/protocol-v1.schema.json', 'engine/scrapling/protocol-v1-vectors.json', 'engine/scrapling/tests/test_engine.py', 'resources/build-toolchain.json']

const fail = (code, cause) => { throw Object.assign(new Error(code), { code, cause }) }
const hashFile = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const coreSemVer = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const exactKeys = (value, keys, code) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code) }

async function assertOrdinaryPath(root, path, code) {
  const rootPath = resolve(root); const target = resolve(path)
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) fail(code)
  let current = rootPath
  if ((await lstat(current)).isSymbolicLink()) fail(code)
  for (const part of relative(rootPath, target).split(sep).filter(Boolean)) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) fail(code) } catch (error) { if (error?.code !== 'ENOENT') throw error; break }
  }
}

async function assertOrdinaryFile(root, path, code) {
  await assertOrdinaryPath(root, path, code)
  const item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink()) fail(code)
}

function git(args, root = projectRoot) { return execFileSync('git.exe', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim() }
function currentCommit() { const value = git(['rev-parse', 'HEAD']); if (!/^[a-f0-9]{40}$/.test(value)) fail('SCRAPLING_SOURCE_COMMIT_INVALID'); return value }
function commitEpoch(root, commit) { const value = Number(git(['show', '-s', '--format=%ct', commit], root)); if (!Number.isSafeInteger(value) || value < 0) fail('SCRAPLING_SOURCE_DATE_INVALID'); return value }

async function inputHashes(root, requireTracked) {
  const hashes = {}
  for (const input of sidecarBuildInputs) {
    const path = join(root, input)
    await assertOrdinaryFile(root, path, 'SCRAPLING_BUILD_INPUT_REPARSE_POINT')
    if (requireTracked) {
      try { git(['ls-files', '--error-unmatch', '--', input]) } catch { fail('SCRAPLING_BUILD_INPUT_UNTRACKED') }
      try { git(['diff', '--quiet', 'HEAD', '--', input]) } catch { fail('SCRAPLING_BUILD_INPUT_MODIFIED') }
    }
    hashes[input] = await hashFile(path)
  }
  return hashes
}

function readVersions(packageJson, requirements, toolchain) {
  const scrapling = requirements.match(/^scrapling\[fetchers\]==([^\r\n]+)$/m)?.[1]
  const pyInstaller = requirements.match(/^pyinstaller==([^\r\n]+)$/m)?.[1]
  if (!coreSemVer.test(packageJson?.version) || !coreSemVer.test(scrapling ?? '') || !coreSemVer.test(pyInstaller ?? '') || toolchain?.python !== '3.12.10' || !coreSemVer.test(toolchain?.pipTools?.version ?? '')) fail('SCRAPLING_VERSION_INPUT_INVALID')
  return { version: packageJson.version, python: toolchain.python, pipTools: toolchain.pipTools.version, pyInstaller, scrapling }
}

function validateManifest(manifest, version) {
  exactKeys(manifest, ['protocolVersion', 'version', 'platform', 'arch', 'archive', 'sourceCommit', 'pythonLockSha256'], 'SCRAPLING_SIDECAR_MANIFEST_INVALID')
  exactKeys(manifest.archive, ['filename', 'size', 'sha256'], 'SCRAPLING_SIDECAR_MANIFEST_INVALID')
  if (manifest.protocolVersion !== 1 || manifest.version !== version || !coreSemVer.test(manifest.version) || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.archive.filename !== archiveName || !Number.isSafeInteger(manifest.archive.size) || manifest.archive.size < 1 || manifest.archive.size > 500_000_000 || !/^[a-f0-9]{64}$/.test(manifest.archive.sha256) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{64}$/.test(manifest.pythonLockSha256)) fail('SCRAPLING_SIDECAR_MANIFEST_INVALID')
}

function validateProvenance(provenance, versions, expectedInputs) {
  exactKeys(provenance, ['sourceCommit', 'package', 'inputs', 'archive', 'result'], 'SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  exactKeys(provenance.package, ['version', 'python', 'pipTools', 'pyInstaller', 'scrapling'], 'SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  exactKeys(provenance.archive, ['filename', 'size', 'sha256'], 'SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  exactKeys(provenance.result, ['pythonTests', 'build', 'sourceDateEpoch'], 'SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  exactKeys(provenance.inputs, sidecarBuildInputs, 'SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  if (!/^[a-f0-9]{40}$/.test(provenance.sourceCommit) || Object.keys(versions).some((key) => provenance.package[key] !== versions[key]) || provenance.result.pythonTests !== 'passed' || provenance.result.build !== 'passed' || !Number.isSafeInteger(provenance.result.sourceDateEpoch) || provenance.result.sourceDateEpoch < 0 || provenance.archive.filename !== archiveName || !Number.isSafeInteger(provenance.archive.size) || provenance.archive.size < 1 || provenance.archive.size > 500_000_000 || !/^[a-f0-9]{64}$/.test(provenance.archive.sha256) || sidecarBuildInputs.some((path) => provenance.inputs[path] !== expectedInputs[path])) fail('SCRAPLING_SIDECAR_PROVENANCE_INVALID')
}

function validateLock(lock) {
  const declarations = []
  for (const line of lock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && declarations.length !== 0) { declarations.at(-1).push(line); continue }
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('--')) fail('SCRAPLING_SIDECAR_LOCK_INVALID')
    declarations.push([line])
  }
  if (declarations.length === 0 || declarations.some((lines) => {
    const header = lines[0].trim().replace(/\\$/, '').trim()
    const invalidContinuation = lines.slice(1).some((line) => !/^[ \t]*(?:#.*|--hash=sha256:[a-f0-9]{64}[ \t]*(?:\\)?[ \t]*)$/.test(line))
    return !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[^\]]+\])?==[^\s\\]+(?:\s+--hash=sha256:[a-f0-9]{64})*$/.test(header) || invalidContinuation || !lines.some((line) => /--hash=sha256:[a-f0-9]{64}/.test(line))
  })) fail('SCRAPLING_SIDECAR_LOCK_INVALID')
}

export async function createScraplingStageDirectory({ outputParent: parent = outputParent, processId = process.pid, randomToken = () => randomBytes(8).toString('hex') } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomToken(); if (!Number.isSafeInteger(processId) || !/^[a-f0-9]{16,}$/.test(token)) fail('SCRAPLING_STAGE_NAME_INVALID')
    const stage = join(parent, `.s-${processId}-${token}`)
    try { await mkdir(stage); return stage } catch (error) { if (error?.code !== 'EEXIST') throw error }
  }
  fail('SCRAPLING_STAGE_COLLISION')
}

export async function promoteScraplingStage({ stage, final, previous, renameFile = rename, removeDirectory = rm }) {
  let backedUp = false
  try { await renameFile(final, previous); backedUp = true } catch (error) { if (error?.code !== 'ENOENT') throw error }
  try { await renameFile(stage, final) } catch (error) {
    if (backedUp) {
      try { await renameFile(previous, final) } catch (rollbackError) { fail('SCRAPLING_PROMOTION_ROLLBACK_FAILED', rollbackError) }
    }
    throw error
  }
  if (backedUp) await removeDirectory(previous, { recursive: true, force: true })
}

export async function verifyGeneratedScraplingResource({ rootDirectory = projectRoot, sourceCommit }) {
  const root = resolve(rootDirectory); const resourceRoot = join(root, '.build-resources', 'scrapling-engine')
  await assertOrdinaryPath(root, resourceRoot, 'SCRAPLING_SIDECAR_REPARSE_POINT')
  const manifestPath = join(resourceRoot, 'engine-manifest.json'); const provenancePath = join(resourceRoot, 'engine-provenance.json')
  await Promise.all([assertOrdinaryFile(root, manifestPath, 'SCRAPLING_SIDECAR_REPARSE_POINT'), assertOrdinaryFile(root, provenancePath, 'SCRAPLING_SIDECAR_REPARSE_POINT')])
  const [manifest, provenance, packageJson, requirements, toolchain, inputs] = await Promise.all([
    readFile(manifestPath, 'utf8').then(JSON.parse), readFile(provenancePath, 'utf8').then(JSON.parse), readFile(join(root, 'package.json'), 'utf8').then(JSON.parse), readFile(join(root, 'engine/scrapling/requirements.txt'), 'utf8'), readFile(join(root, 'resources/build-toolchain.json'), 'utf8').then(JSON.parse), inputHashes(root, false)
  ])
  const versions = readVersions(packageJson, requirements, toolchain)
  validateManifest(manifest, versions.version); validateProvenance(provenance, versions, inputs)
  if (manifest.sourceCommit !== sourceCommit || provenance.sourceCommit !== sourceCommit || manifest.pythonLockSha256 !== inputs['engine/scrapling/requirements.lock.txt']) fail('SCRAPLING_SIDECAR_SOURCE_COMMIT_MISMATCH')
  if (provenance.result.sourceDateEpoch !== commitEpoch(root, sourceCommit)) fail('SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  validateLock(await readFile(join(root, 'engine/scrapling/requirements.lock.txt'), 'utf8'))
  const archivePath = join(resourceRoot, archiveName); await assertOrdinaryPath(root, archivePath, 'SCRAPLING_SIDECAR_REPARSE_POINT')
  await assertOrdinaryFile(root, archivePath, 'SCRAPLING_SIDECAR_REPARSE_POINT')
  const archive = await stat(archivePath); const digest = await hashFile(archivePath)
  if (manifest.archive.size !== archive.size || manifest.archive.sha256 !== digest || provenance.archive.size !== archive.size || provenance.archive.sha256 !== digest) fail('SCRAPLING_SIDECAR_PROVENANCE_INVALID')
  return manifest
}

export async function buildScraplingEngine() {
  if (process.argv.length > 2) fail('SCRAPLING_BUILD_ARGUMENTS_UNSUPPORTED')
  const sourceCommit = currentCommit(); const sourceDateEpoch = commitEpoch(projectRoot, sourceCommit)
  await assertOrdinaryPath(projectRoot, engineRoot, 'SCRAPLING_CHECKOUT_REPARSE_POINT')
  const inputs = await inputHashes(projectRoot, true)
  const [packageJson, requirements, toolchain] = await Promise.all([readFile(join(projectRoot, 'package.json'), 'utf8').then(JSON.parse), readFile(join(engineRoot, 'requirements.txt'), 'utf8'), readFile(join(projectRoot, 'resources/build-toolchain.json'), 'utf8').then(JSON.parse)])
  const versions = readVersions(packageJson, requirements, toolchain)
  await mkdir(outputParent, { recursive: true }); await assertOrdinaryPath(projectRoot, outputParent, 'SCRAPLING_OUTPUT_REPARSE_POINT')
  const stage = await createScraplingStageDirectory(); await assertOrdinaryPath(projectRoot, stage, 'SCRAPLING_OUTPUT_REPARSE_POINT')
  const final = join(outputParent, 'scrapling-engine'); const previous = join(outputParent, `.sp-${process.pid}-${randomBytes(8).toString('hex')}`)
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(engineRoot, 'build.ps1'), '-Python', join(engineRoot, '.venv', 'Scripts', 'python.exe'), '-OutputRoot', stage, '-SourceDateEpoch', String(sourceDateEpoch)], { cwd: projectRoot, stdio: 'inherit', windowsHide: true })
    const archivePath = join(stage, archiveName); const archive = await stat(archivePath); const archiveHash = await hashFile(archivePath)
    const manifest = { protocolVersion: 1, version: versions.version, platform: 'win32', arch: 'x64', archive: { filename: archiveName, size: archive.size, sha256: archiveHash }, sourceCommit, pythonLockSha256: inputs['engine/scrapling/requirements.lock.txt'] }
    const provenance = { sourceCommit, package: versions, inputs, archive: manifest.archive, result: { pythonTests: 'passed', build: 'passed', sourceDateEpoch } }
    await Promise.all([writeFile(join(stage, 'engine-manifest.json'), JSON.stringify(manifest, null, 2) + '\n'), writeFile(join(stage, 'engine-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')])
    await promoteScraplingStage({ stage, final, previous })
    return await verifyGeneratedScraplingResource({ rootDirectory: projectRoot, sourceCommit })
  } finally { await rm(stage, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) buildScraplingEngine().catch((error) => { console.error(error instanceof Error ? error.message : 'SCRAPLING_BUILD_FAILED'); process.exitCode = 1 })
