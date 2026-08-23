import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sidecarBuildInputs, verifyGeneratedScraplingResource } from './build-scrapling-engine.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(scriptPath, '..', '..')
const sidecarFiles = new Set(['scrapling-engine-win32-x64.zip', 'engine-manifest.json', 'engine-provenance.json'])
const sidecarResources = new Map([
  ['.build-resources/scrapling-engine/scrapling-engine-win32-x64.zip', 'scrapling-engine/scrapling-engine-win32-x64.zip'],
  ['.build-resources/scrapling-engine/engine-manifest.json', 'scrapling-engine/manifest.json'],
  ['.build-resources/scrapling-engine/engine-provenance.json', 'scrapling-engine/engine-provenance.json']
])
const ffmpegTrackedInputs = ['package.json', 'package-lock.json', 'resources/ffmpeg-manifest.json', 'scripts/verify-resource-completeness.mjs', 'scripts/verify-release-dependencies.mjs']
const resourceVerifierTrackedInputs = ['package.json', 'package-lock.json', 'resources/model-manifest.json', 'resources/ffmpeg-manifest.json', ...sidecarBuildInputs, 'scripts/verify-resource-completeness.mjs', 'scripts/verify-release-dependencies.mjs', 'scripts/prepare-model-resource.mjs']

const fail = (code) => { throw new Error(code) }
const sha256 = /^[a-f0-9]{64}$/
const commit = /^[a-f0-9]{40}$/
const basename = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export async function verifyResourceCompleteness({
  rootDirectory = projectRoot,
  packageJson: suppliedPackage,
  modelManifest: suppliedModel,
  ffmpegManifest: suppliedFfmpeg,
  trackedFiles: suppliedTracked,
  sourceCommit: suppliedSourceCommit,
  verifyGeneratedScrapling: suppliedVerifyGeneratedScrapling,
  verifyFfmpeg: suppliedVerifyFfmpeg
} = {}) {
  const root = resolve(rootDirectory)
  const production = suppliedPackage === undefined && suppliedModel === undefined && suppliedFfmpeg === undefined && suppliedTracked === undefined && suppliedSourceCommit === undefined && suppliedVerifyGeneratedScrapling === undefined && suppliedVerifyFfmpeg === undefined
  const verifyGeneratedScrapling = suppliedVerifyGeneratedScrapling ?? verifyGeneratedScraplingResource
  const verifyFfmpeg = suppliedVerifyFfmpeg ?? verifyFfmpegResource
  const sourceCommit = suppliedSourceCommit ?? currentCommit(root)
  const packageJson = suppliedPackage ?? await readJson(join(root, 'package.json'))
  const trackedFiles = suppliedTracked ?? readTrackedFiles(root)
  const modelManifest = suppliedModel ?? await readProductionManifest(root, trackedFiles, 'resources/model-manifest.json')
  const extraResources = packageJson?.build?.extraResources
  if (!commit.test(sourceCommit)) fail('RESOURCE_CURRENT_COMMIT_INVALID')
  if (!Array.isArray(extraResources) || extraResources.length === 0) fail('RESOURCE_CONFIGURATION_MISSING')
  for (const [from, to] of sidecarResources) if (extraResources.filter((entry) => entry?.from === from && entry?.to === to).length !== 1) fail('RESOURCE_SCRAPLING_CONFIGURATION_INVALID')
  await validateExtraResourceDestinations(root, extraResources)
  if (production) {
    await verifyTrackedInputsAtHead({ rootDirectory: root, trackedFiles, inputs: resourceTrackedInputs(extraResources, trackedFiles) })
    if (currentCommit(root) !== sourceCommit) fail('RESOURCE_CURRENT_COMMIT_MISMATCH')
  }

  validateModelManifest(modelManifest)
  const sidecar = await verifyGeneratedScrapling({ rootDirectory: root, sourceCommit })
  if (sidecar?.sourceCommit !== sourceCommit) fail('RESOURCE_SCRAPLING_CURRENT_COMMIT_MISMATCH')
  await verifySidecarInventory(root)

  const resources = []
  for (const entry of extraResources) {
    if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string') fail('RESOURCE_CONFIGURATION_INVALID')
    const relativePath = normalizeRelative(entry.from)
    const absolutePath = resolveInside(root, relativePath)
    await rejectLinks(root, absolutePath, relativePath)

    if (relativePath === '.build-resources/scrapling-engine/scrapling-engine-win32-x64.zip') {
      resources.push({ path: relativePath, destination: entry.to, origin: 'GENERATED', ...(await verifyFile(absolutePath, sidecar.archive, relativePath)) })
      continue
    }
    if (relativePath === '.build-resources/scrapling-engine/engine-manifest.json' || relativePath === '.build-resources/scrapling-engine/engine-provenance.json') {
      resources.push({ path: relativePath, destination: entry.to, origin: 'GENERATED', ...(await hashFile(absolutePath)) })
      continue
    }
    if (relativePath === '.build-resources/models') {
      const files = []
      const modelDirectory = resolveInside(root, join(relativePath, modelManifest.id))
      await assertOrdinaryPath(root, modelDirectory, 'RESOURCE_MODEL_REPARSE_POINT')
      for (const [name, expected] of Object.entries(modelManifest.files)) {
        const modelRelative = `${relativePath}/${modelManifest.id}/${name}`
        const modelPath = resolveInside(root, join(relativePath, modelManifest.id, name))
        await assertOrdinaryFileOrMissing(root, modelPath, 'RESOURCE_MODEL_REPARSE_POINT')
        files.push({ name, ...(await verifyFile(modelPath, expected, modelRelative)) })
      }
      resources.push({ path: relativePath, destination: entry.to, origin: 'FETCHED', modelId: modelManifest.id, files })
      continue
    }
    if (!trackedFiles.has(relativePath)) fail(`RESOURCE_NOT_GIT_TRACKED:${relativePath}`)
    const info = await stat(absolutePath)
    if (!info.isFile()) fail(`RESOURCE_TRACKED_FILE_INVALID:${relativePath}`)
    resources.push({ path: relativePath, destination: entry.to, origin: 'TRACKED', ...(await hashFile(absolutePath)) })
  }

  resources.push({ path: 'node_modules/ffmpeg-static/ffmpeg.exe', origin: 'NODE_MODULE', ...(await verifyFfmpeg({ rootDirectory: root, manifest: suppliedFfmpeg, trackedFiles })) })
  return { status: 'COMPLETE', sourceCommit, resources }
}

export async function verifyFfmpegResource({ rootDirectory = projectRoot, manifest: suppliedManifest, trackedFiles: suppliedTracked } = {}) {
  const root = resolve(rootDirectory)
  const trackedFiles = suppliedTracked ?? (suppliedManifest ? undefined : readTrackedFiles(root))
  if (suppliedManifest === undefined && suppliedTracked === undefined) await verifyTrackedInputsAtHead({ rootDirectory: root, trackedFiles, inputs: ffmpegTrackedInputs })
  const manifest = suppliedManifest ?? await readProductionManifest(root, trackedFiles, 'resources/ffmpeg-manifest.json')
  validateFfmpegManifest(manifest)
  const packageDirectory = join(root, 'node_modules', manifest.package.name)
  await assertOrdinaryPath(root, packageDirectory, 'RESOURCE_FFMPEG_REPARSE_POINT')
  const packageJsonPath = join(packageDirectory, 'package.json')
  const executable = join(packageDirectory, manifest.asset.decompressed.filename)
  const readmePath = join(packageDirectory, `${manifest.asset.decompressed.filename}.README`)
  const licensePath = join(packageDirectory, `${manifest.asset.decompressed.filename}.LICENSE`)
  await Promise.all([
    assertOrdinaryFile(root, packageJsonPath, 'RESOURCE_FFMPEG_REPARSE_POINT'),
    assertOrdinaryFile(root, executable, 'RESOURCE_FFMPEG_REPARSE_POINT'),
    assertOrdinaryFile(root, readmePath, 'RESOURCE_FFMPEG_REPARSE_POINT'),
    assertOrdinaryFile(root, licensePath, 'RESOURCE_FFMPEG_REPARSE_POINT')
  ])
  const installed = await readJson(packageJsonPath)
  if (installed?.name !== manifest.package.name || installed?.version !== manifest.package.version || installed?.license !== manifest.license.spdx || installed?.['ffmpeg-static']?.['binary-release-tag'] !== manifest.release.tag || installed?.['ffmpeg-static']?.['executable-base-name'] !== manifest.release.executableBaseName || installed?.repository?.url !== 'https://github.com/eugeneware/ffmpeg-static') fail('RESOURCE_FFMPEG_PACKAGE_METADATA_INVALID')
  const verified = await verifyFile(executable, manifest.asset.decompressed, 'node_modules/ffmpeg-static/ffmpeg.exe')
  await Promise.all([
    verifyFile(readmePath, manifest.readme, 'node_modules/ffmpeg-static/ffmpeg.exe.README'),
    verifyFile(licensePath, manifest.license, 'node_modules/ffmpeg-static/ffmpeg.exe.LICENSE')
  ])
  return verified
}

export function validateModelManifest(manifest) {
  exactKeys(manifest, ['id', 'displayName', 'upstream', 'files'], 'RESOURCE_MODEL_MANIFEST_INVALID')
  exactKeys(manifest.upstream, ['repository', 'revision', 'license', 'licenseUrl'], 'RESOURCE_MODEL_MANIFEST_INVALID')
  if (typeof manifest.id !== 'string' || !isSafeBasename(manifest.id) || typeof manifest.displayName !== 'string' || manifest.displayName.trim() === '' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(manifest.upstream.repository) || !commit.test(manifest.upstream.revision) || typeof manifest.upstream.license !== 'string' || manifest.upstream.license === '' || manifest.upstream.licenseUrl !== `https://huggingface.co/${manifest.upstream.repository}/resolve/${manifest.upstream.revision}/LICENSE`) fail('RESOURCE_MODEL_MANIFEST_INVALID')
  const files = Object.entries(manifest.files)
  if (files.length === 0) fail('RESOURCE_MODEL_MANIFEST_EMPTY')
  for (const [name, file] of files) {
    exactKeys(file, ['url', 'size', 'sha256'], 'RESOURCE_MODEL_MANIFEST_INVALID')
    if (!isSafeBasename(name)) fail('RESOURCE_MODEL_MANIFEST_INVALID')
    if (file.url !== `https://huggingface.co/${manifest.upstream.repository}/resolve/${manifest.upstream.revision}/${name}`) fail(`RESOURCE_MODEL_URL_INVALID:${name}`)
    if (!Number.isSafeInteger(file.size) || file.size < 1 || !sha256.test(file.sha256)) fail('RESOURCE_MODEL_MANIFEST_INVALID')
  }
  return manifest
}

export function validateFfmpegManifest(manifest) {
  exactKeys(manifest, ['schemaVersion', 'package', 'release', 'platform', 'arch', 'sourceBaseUrl', 'asset', 'readme', 'license'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.package, ['name', 'version'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.release, ['tag', 'executableBaseName'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.asset, ['compressed', 'decompressed'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.asset.compressed, ['url', 'size', 'sha256'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.asset.decompressed, ['filename', 'url', 'size', 'sha256'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.readme, ['url', 'size', 'sha256'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  exactKeys(manifest.license, ['url', 'size', 'sha256', 'spdx', 'redistributionNotice'], 'RESOURCE_FFMPEG_MANIFEST_INVALID')
  if (manifest.schemaVersion !== 1 || manifest.package.name !== 'ffmpeg-static' || manifest.package.version !== '5.3.0' || manifest.release.tag !== 'b6.1.1' || manifest.release.executableBaseName !== 'ffmpeg' || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.sourceBaseUrl !== 'https://github.com/eugeneware/ffmpeg-static/releases/download' || manifest.asset.compressed.url !== `${manifest.sourceBaseUrl}/${manifest.release.tag}/ffmpeg-win32-x64.gz` || manifest.asset.decompressed.url !== manifest.asset.compressed.url || manifest.asset.decompressed.filename !== 'ffmpeg.exe' || manifest.readme.url !== `${manifest.sourceBaseUrl}/${manifest.release.tag}/win32-x64.README` || manifest.license.url !== `${manifest.sourceBaseUrl}/${manifest.release.tag}/win32-x64.LICENSE` || manifest.license.spdx !== 'GPL-3.0-or-later' || !manifest.license.redistributionNotice.includes('GPL-3.0-or-later')) fail('RESOURCE_FFMPEG_MANIFEST_INVALID')
  for (const value of [manifest.asset.compressed, manifest.asset.decompressed, manifest.readme, manifest.license]) if (!Number.isSafeInteger(value.size) || value.size < 1 || !sha256.test(value.sha256)) fail('RESOURCE_FFMPEG_MANIFEST_INVALID')
  return manifest
}

async function verifySidecarInventory(root) {
  const sidecarDirectory = join(root, '.build-resources', 'scrapling-engine')
  await assertOrdinaryPath(root, sidecarDirectory, 'RESOURCE_SCRAPLING_REPARSE_POINT')
  const entries = await readdir(sidecarDirectory, { withFileTypes: true })
  if (entries.length !== sidecarFiles.size || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !sidecarFiles.has(entry.name))) fail('RESOURCE_SCRAPLING_SIDECAR_INVENTORY_INVALID')
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code)
}

function isSafeBasename(value) { return typeof value === 'string' && basename.test(value) && value !== '.' && value !== '..' }

function normalizeRelative(value) { return value.replaceAll('\\', '/') }

function normalizeDestination(value) {
  if (typeof value !== 'string') fail('RESOURCE_DESTINATION_INVALID')
  const normalized = normalizeRelative(value)
  if (normalized === '' || isAbsolute(normalized)) fail('RESOURCE_DESTINATION_INVALID')
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) fail('RESOURCE_DESTINATION_INVALID')
  return parts.join('/')
}

async function validateExtraResourceDestinations(root, entries) {
  const destinations = []
  for (const entry of entries) {
    if (!entry || typeof entry.from !== 'string') fail('RESOURCE_CONFIGURATION_INVALID')
    const source = normalizeRelative(entry.from)
    const destination = normalizeDestination(entry.to)
    const path = resolveInside(root, source)
    await rejectLinks(root, path, source)
    destinations.push(destination.toLowerCase())
  }
  for (let index = 0; index < destinations.length; index += 1) {
    for (let other = index + 1; other < destinations.length; other += 1) {
      const left = destinations[index]; const right = destinations[other]
      if (isDestinationParent(left, right) || isDestinationParent(right, left)) fail('RESOURCE_DESTINATION_INVALID')
    }
  }
}

function isDestinationParent(parent, child) { return parent === child || child.startsWith(`${parent}/`) }

function resolveInside(root, relativePath) {
  const absolutePath = resolve(root, relativePath)
  const fromRoot = relative(root, absolutePath)
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) fail(`RESOURCE_PATH_OUTSIDE_CHECKOUT:${relativePath}`)
  return absolutePath
}

async function assertOrdinaryPath(root, target, code) {
  const rootReal = await realpath(root)
  let current = root
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch { fail(code) }
    if (info.isSymbolicLink()) fail(code)
  }
  const targetReal = await realpath(target)
  const fromRoot = relative(rootReal, targetReal)
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) fail(code)
}

async function assertOrdinaryFile(root, target, code) {
  await assertOrdinaryPath(root, target, code)
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) fail(code)
}

async function assertOrdinaryFileOrMissing(root, target, code) {
  try {
    await assertOrdinaryFile(root, target, code)
  } catch (error) {
    if (error?.message !== code) throw error
    try { await lstat(target) } catch (cause) { if (cause?.code === 'ENOENT') return; throw cause }
    throw error
  }
}

async function rejectLinks(root, target, relativePath) {
  try { await assertOrdinaryPath(root, target, `RESOURCE_REPARSE_POINT_REJECTED:${relativePath}`) } catch (error) { if (error.message.startsWith('RESOURCE_REPARSE_POINT_REJECTED:')) throw error; fail(`RESOURCE_MISSING:${relativePath}`) }
  const info = await lstat(target)
  if (info.isDirectory()) await rejectNestedLinks(target, relativePath)
}

async function rejectNestedLinks(directory, relativePath) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name)
    if (entry.isSymbolicLink()) fail(`RESOURCE_REPARSE_POINT_REJECTED:${relativePath}/${entry.name}`)
    if (entry.isDirectory()) await rejectNestedLinks(child, `${relativePath}/${entry.name}`)
  }
}

async function verifyFile(path, expected, relativePath) {
  let info
  try { info = await stat(path) } catch { fail(`RESOURCE_MISSING:${relativePath}`) }
  if (!info.isFile() || info.size !== expected.size) fail(`RESOURCE_SIZE_MISMATCH:${relativePath}`)
  const hashed = await hashFile(path)
  if (hashed.sha256 !== expected.sha256) fail(`RESOURCE_HASH_MISMATCH:${relativePath}`)
  return hashed
}

async function hashFile(path) {
  const info = await stat(path)
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return { size: info.size, sha256: hash.digest('hex') }
}

async function readProductionManifest(root, trackedFiles, relativePath) {
  if (!trackedFiles.has(relativePath)) fail(`RESOURCE_MANIFEST_NOT_GIT_TRACKED:${relativePath}`)
  const path = resolveInside(root, relativePath)
  await assertOrdinaryFile(root, path, `RESOURCE_MANIFEST_REPARSE_POINT:${relativePath}`)
  return readJson(path)
}

function currentCommit(root) {
  const value = execFileSync('git.exe', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  if (!commit.test(value)) fail('RESOURCE_CURRENT_COMMIT_INVALID')
  return value
}

function readTrackedFiles(root) {
  const result = spawnSync('git.exe', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) fail('RESOURCE_GIT_INVENTORY_FAILED')
  return new Set(result.stdout.split('\0').filter(Boolean).map(normalizeRelative))
}

export async function verifyTrackedInputsAtHead({ rootDirectory = projectRoot, trackedFiles: suppliedTracked, inputs } = {}) {
  const root = resolve(rootDirectory)
  const trackedFiles = suppliedTracked ?? readTrackedFiles(root)
  const uniqueInputs = [...new Set(inputs.map(normalizeRelative))]
  for (const input of uniqueInputs) if (!trackedFiles.has(input)) fail(`RESOURCE_TRACKED_INPUT_NOT_GIT_TRACKED:${input}`)
  const result = spawnSync('git.exe', ['-C', root, 'diff', '--quiet', 'HEAD', '--', ...uniqueInputs], { windowsHide: true })
  if (result.status !== 0) fail('RESOURCE_TRACKED_INPUT_DIRTY')
  return uniqueInputs
}

function resourceTrackedInputs(extraResources, trackedFiles) {
  const packagedInputs = []
  for (const entry of extraResources) {
    const source = normalizeRelative(entry.from)
    if (source === '.build-resources' || source.startsWith('.build-resources/') || source === 'node_modules' || source.startsWith('node_modules/')) continue
    const matches = [...trackedFiles].filter((path) => path === source || path.startsWith(`${source}/`))
    packagedInputs.push(...(matches.length === 0 ? [source] : matches))
  }
  return [...new Set([...resourceVerifierTrackedInputs, ...packagedInputs])]
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

async function writeResult(path, value) {
  if (!isAbsolute(path)) fail('RESOURCE_RESULT_PATH_MUST_BE_ABSOLUTE')
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resultIndex = process.argv.indexOf('--result')
  const resultPath = resultIndex >= 0 ? process.argv[resultIndex + 1] : undefined
  if (resultIndex >= 0 && !resultPath) {
    console.error('RESOURCE_RESULT_PATH_REQUIRED')
    process.exitCode = 1
  } else {
    verifyResourceCompleteness().then(async (result) => {
      if (resultPath) await writeResult(resultPath, result)
      console.log(JSON.stringify(result, null, 2))
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : 'RESOURCE_COMPLETENESS_FAILED')
      process.exitCode = 1
    })
  }
}
