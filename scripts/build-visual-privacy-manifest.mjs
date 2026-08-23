import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const VISUAL_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.docx', '.pdf'])
const DEFAULT_LIMITS = {
  maxDepth: 20,
  maxAuditEntries: 10_000,
  maxAssets: 5_000,
  maxFileBytes: 268_435_456,
  maxTotalBytes: 2_147_483_648
}
const WINDOWS_REPARSE_AUDIT_COMMAND = `$ErrorActionPreference = 'Stop'
$json = [Console]::In.ReadToEnd()
$request = $json | ConvertFrom-Json
function Test-ReparsePoint([string] $path) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 }
}
try {
  foreach ($path in $request.exactPaths) { Test-ReparsePoint $path }
  $entryCount = 0
  foreach ($root in $request.recursiveRoots) {
    Test-ReparsePoint $root
    $queue = New-Object 'System.Collections.Queue'
    $queue.Enqueue([PSCustomObject]@{ Path = $root; Depth = 0 })
    while ($queue.Count -gt 0) {
      $current = $queue.Dequeue()
      Get-ChildItem -LiteralPath $current.Path -Force -ErrorAction Stop | ForEach-Object {
        $entry = $_
        $entryCount += 1
        if ($entryCount -gt [int]$request.maxAuditEntries) { exit 4 }
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 }
        if ($entry.PSIsContainer) {
          $nextDepth = [int]$current.Depth + 1
          if ($nextDepth -gt [int]$request.maxDepth) { exit 4 }
          $queue.Enqueue([PSCustomObject]@{ Path = $entry.FullName; Depth = $nextDepth })
        }
      }
    }
  }
  exit 0
} catch {
  exit 5
}
`

export async function buildVisualPrivacyManifest(options) {
  try {
    const candidateRoot = absoluteDirectory(options.candidateRoot)
    const releaseRoot = absoluteDirectory(options.releaseRoot)
    const reportPath = absoluteFile(options.reportPath)
    const limits = resolveLimits(options.limits)
    const reparseAudit = options.reparseAudit ?? auditReparsePoints

    rejectOverlap(candidateRoot, releaseRoot)
    rejectExternalReport(reportPath, candidateRoot, releaseRoot)
    assertReportAbsent(reportPath)
    await reparseAudit(auditRequest({
      exactPaths: [...existingAncestors(candidateRoot), ...existingAncestors(releaseRoot), ...existingAncestors(reportPath)],
      recursiveRoots: [candidateRoot, releaseRoot],
      limits
    }))
    // The audit is a snapshot. The walker rejects links and rechecks directory
    // identities afterwards; a transient exotic Windows reparse race remains local.
    await options.afterInitialAudit?.()

    const candidateIdentity = rootIdentity(candidateRoot)
    const releaseIdentity = rootIdentity(releaseRoot)
    const state = { assets: 0, entries: 0, totalBytes: 0, limits }
    const assets = [
      ...await collectVisualAssets(candidateRoot, 'candidate', state),
      ...await collectVisualAssets(releaseRoot, 'release', state)
    ].sort((left, right) => left.path.localeCompare(right.path))
    const reportDirectory = dirname(reportPath)
    mkdirSync(reportDirectory, { recursive: true })
    await reparseAudit(auditRequest({ exactPaths: existingAncestors(reportPath), recursiveRoots: [], limits }))
    assertReportAbsent(reportPath)

    const tempPath = join(reportDirectory, `.visual-privacy-${process.pid}-${randomUUID()}.tmp`)
    let completed = false
    try {
      writeAtomicTemp(tempPath, Buffer.from(`${JSON.stringify({ assets }, null, 2)}\n`, 'utf8'))
      await options.beforePublish?.()
      verifyRootIdentity(candidateRoot, candidateIdentity)
      verifyRootIdentity(releaseRoot, releaseIdentity)
      await reparseAudit(auditRequest({
        exactPaths: existingAncestors(reportPath),
        recursiveRoots: [candidateRoot, releaseRoot],
        limits
      }))
      rejectOverlap(candidateRoot, releaseRoot)
      rejectExternalReport(reportPath, candidateRoot, releaseRoot)
      assertReportAbsent(reportPath)
      await options.beforeLink?.()
      // link is create-only: unlike rename, it cannot replace a report created
      // after the absence check.
      linkSync(tempPath, reportPath)
      unlinkSync(tempPath)
      completed = true
      return { assets }
    } finally {
      if (!completed) removeExactTemp(tempPath)
    }
  } catch {
    throw new Error('VISUAL_PRIVACY_MANIFEST_INVALID')
  }
}

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag || !value || !flag.startsWith('--') || values.has(flag)) throw new Error('INVALID_ARGUMENTS')
    values.set(flag, value)
  }
  if (values.size !== 3) throw new Error('INVALID_ARGUMENTS')
  return {
    candidateRoot: values.get('--candidate-root'),
    releaseRoot: values.get('--release-root'),
    reportPath: values.get('--report-path')
  }
}

function absoluteDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('INVALID_DIRECTORY')
  const entry = lstatMaybe(path)
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error('INVALID_DIRECTORY')
  return resolve(path)
}

function absoluteFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('INVALID_REPORT_PATH')
  return resolve(path)
}

function resolveLimits(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const value of Object.values(limits)) {
    if (!Number.isInteger(value) || value < 0) throw new Error('INVALID_LIMITS')
  }
  return limits
}

function lstatMaybe(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error).code === 'ENOENT') return null
    throw error
  }
}

function existingAncestors(path) {
  const ancestors = []
  let current = resolve(path)
  while (true) {
    if (lstatMaybe(current)) ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) return ancestors
    current = parent
  }
}

function auditRequest({ exactPaths, recursiveRoots, limits }) {
  return {
    exactPaths: uniqueSorted(exactPaths),
    recursiveRoots: uniqueSorted(recursiveRoots),
    maxDepth: limits.maxDepth,
    maxAuditEntries: limits.maxAuditEntries
  }
}

function uniqueSorted(paths) {
  const pathsByNormalizedValue = new Map()
  for (const path of paths) pathsByNormalizedValue.set(normalize(resolve(path)), resolve(path))
  return [...pathsByNormalizedValue.values()].sort((left, right) => normalize(left).localeCompare(normalize(right)))
}

export function auditReparsePoints(request, options = {}) {
  if (process.platform !== 'win32') return
  const powerShell = options.powershellPath === undefined
    ? resolveWindowsPowerShell()
    : resolveTestPowerShell(options.powershellPath)
  const environment = {}
  environment.SystemRoot = process.env.SystemRoot
  for (const name of ['ComSpec', 'TEMP', 'TMP']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  const result = (options.spawn ?? spawnSync)(powerShell.path, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    WINDOWS_REPARSE_AUDIT_COMMAND
  ], {
    env: environment,
    input: JSON.stringify(request),
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1_024
  })
  verifyPowerShellIdentity(powerShell)
  if (result.status === 0) return
  if (result.status === 3) throw new Error('REPARSE_POINT')
  throw new Error('REPARSE_AUDIT_FAILED')
}

function resolveWindowsPowerShell() {
  // Trust only the OS-provided SystemRoot hierarchy; never resolve PowerShell
  // through PATH. Its executable identity is checked before and after the audit.
  const systemRoot = process.env.SystemRoot
  if (typeof systemRoot !== 'string' || !/^[a-z]:[\\/]/i.test(systemRoot) || !isAbsolute(systemRoot)) throw new Error('INVALID_SYSTEM_ROOT')
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const ancestors = existingAncestors(executable)
  if (!ancestors.some((path) => normalize(path) === normalize(resolve(systemRoot)))) throw new Error('INVALID_SYSTEM_ROOT')
  for (const path of ancestors) {
    const entry = lstatSync(path)
    if (entry.isSymbolicLink()) throw new Error('REPARSE_POINT')
    if (normalize(path) === normalize(executable)) {
      if (!entry.isFile()) throw new Error('INVALID_POWERSHELL')
    } else if (!entry.isDirectory()) throw new Error('INVALID_SYSTEM_ROOT')
  }
  const entry = lstatSync(executable)
  return { path: executable, identity: fileIdentity(entry) }
}

function resolveTestPowerShell(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('INVALID_POWERSHELL')
  const executable = resolve(path)
  const entry = lstatSync(executable)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('INVALID_POWERSHELL')
  return { path: executable, identity: fileIdentity(entry) }
}

function verifyPowerShellIdentity(powerShell) {
  const entry = lstatSync(powerShell.path)
  if (!entry.isFile() || entry.isSymbolicLink() || !sameIdentity(powerShell.identity, fileIdentity(entry))) throw new Error('POWERSHELL_CHANGED')
}

function rejectOverlap(left, right) {
  if (isSameOrChild(left, right) || isSameOrChild(right, left)) throw new Error('OVERLAPPING_ROOTS')
}

function rejectExternalReport(reportPath, candidateRoot, releaseRoot) {
  if (isSameOrChild(reportPath, candidateRoot) || isSameOrChild(reportPath, releaseRoot)) throw new Error('REPORT_NOT_EXTERNAL')
}

function isSameOrChild(path, root) {
  const normalizedPath = normalize(path)
  const normalizedRoot = normalize(root)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`)
}

function assertReportAbsent(path) {
  if (lstatMaybe(path)) throw new Error('REPORT_ALREADY_EXISTS')
}

function rootIdentity(path) {
  const entry = lstatSync(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('INVALID_DIRECTORY')
  return fileIdentity(entry)
}

function verifyRootIdentity(path, identity) {
  if (!sameIdentity(identity, rootIdentity(path))) throw new Error('ROOT_CHANGED')
}

function fileIdentity(entry) {
  return {
    dev: entry.dev,
    ino: entry.ino,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.ctimeMs
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

async function collectVisualAssets(root, prefix, state) {
  const assets = []
  await walk(root, root, prefix, state, assets, 0)
  return assets
}

async function walk(root, directory, prefix, state, assets, depth) {
  if (depth > state.limits.maxDepth) throw new Error('DEPTH_LIMIT')
  const directoryIdentity = rootIdentity(directory)
  const handle = opendirSync(directory)
  try {
    for (let dirent = handle.readSync(); dirent !== null; dirent = handle.readSync()) {
      state.entries += 1
      if (state.entries > state.limits.maxAuditEntries) throw new Error('AUDIT_ENTRY_LIMIT')
      const path = join(directory, dirent.name)
      const entry = lstatSync(path)
      if (entry.isSymbolicLink()) throw new Error('REPARSE_POINT')
      if (entry.isDirectory()) {
        await walk(root, path, prefix, state, assets, depth + 1)
        continue
      }
      if (!entry.isFile() || !VISUAL_EXTENSIONS.has(extension(dirent.name))) continue
      if (entry.size > state.limits.maxFileBytes) throw new Error('FILE_LIMIT')
      if (state.assets + 1 > state.limits.maxAssets) throw new Error('ASSET_LIMIT')
      if (state.totalBytes + entry.size > state.limits.maxTotalBytes) throw new Error('TOTAL_LIMIT')
      const sha256 = await stableSha256(path, entry)
      state.assets += 1
      state.totalBytes += entry.size
      assets.push({
        path: `${prefix}/${relative(root, path).split(sep).join('/')}`,
        bytes: entry.size,
        sha256,
        status: 'REVIEW_REQUIRED'
      })
    }
  } finally {
    handle.closeSync()
  }
  verifyRootIdentity(directory, directoryIdentity)
}

function extension(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

function stableSha256(path, before) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    let bytes = 0
    stream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > before.size) stream.destroy(new Error('ASSET_CHANGED'))
      else hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => {
      try {
        const after = lstatSync(path)
        if (after.isSymbolicLink()) throw new Error('REPARSE_POINT')
        if (!after.isFile() || !sameIdentity(fileIdentity(before), fileIdentity(after)) || bytes !== before.size) throw new Error('ASSET_CHANGED')
        resolveHash(hash.digest('hex'))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function writeAtomicTemp(path, content) {
  const descriptor = openSync(path, 'wx')
  try {
    writeSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function removeExactTemp(path) {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error).code !== 'ENOENT') throw error
  }
}

function normalize(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  try {
    await buildVisualPrivacyManifest(parseArguments(process.argv.slice(2)))
  } catch {
    process.stderr.write('VISUAL_PRIVACY_MANIFEST_INVALID\n')
    process.exitCode = 1
  }
}
