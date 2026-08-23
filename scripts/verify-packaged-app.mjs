import { execFile, spawn } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { listPackage } from '@electron/asar'

const execFileAsync = promisify(execFile)
const TEST_ROOT = resolve('E:\\10500\\radar-test')
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appExecutable = resolve('release/win-unpacked/HitMuse.exe')
const appArchive = resolve('release/win-unpacked/resources/app.asar')
const appUpdateConfig = resolve('release/win-unpacked/resources/app-update.yml')
const directoryLockScript = fileURLToPath(new URL('./hold-directory-lock.ps1', import.meta.url))
const requiredFiles = [
  'node_modules/electron-updater/out/main.js',
  'node_modules/fs-extra/package.json'
]
const runtimeReadinessFilename = 'runtime-readiness.json'
const maxRuntimeReadinessBytes = 512
export const CANONICAL_SMOKE_DENY_HOSTS = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co', 'api.hitmuse.com', 'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com']

function isStrictDescendant(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent !== '' &&
    pathFromParent !== '..' &&
    !pathFromParent.startsWith('..\\') &&
    !pathFromParent.startsWith('../') &&
    !isAbsolute(pathFromParent)
}

export function parseSmokeArguments(argumentsList) {
  const usesDefaultRoot = argumentsList.length === 4
  const usesExplicitRoot = argumentsList.length === 6 && argumentsList[4] === '--smoke-test-root'
  if ((!usesDefaultRoot && !usesExplicitRoot) || argumentsList[0] !== '--smoke-user-data-dir' || argumentsList[2] !== '--smoke-deny-hosts-file') {
    throw new Error('PACKAGED_APP_SMOKE_ARGUMENTS: provide exactly --smoke-user-data-dir, --smoke-deny-hosts-file, and optional trailing --smoke-test-root.')
  }
  const smoke = assertSafeSmokeUserData(argumentsList[1], usesExplicitRoot ? argumentsList[5] : TEST_ROOT)
  if (typeof argumentsList[3] !== 'string' || !isAbsolute(argumentsList[3])) {
    throw new Error('PACKAGED_APP_SMOKE_DENY_HOSTS_PATH: deny-hosts path must be absolute.')
  }
  const denyHostsFile = resolve(argumentsList[3])
  if (!pathEquals(denyHostsFile, join(smoke.smokeRoot, 'deny-hosts.json'))) {
    throw new Error('PACKAGED_APP_SMOKE_DENY_HOSTS_PATH: deny-hosts file must be the exact immediate deny-hosts.json child.')
  }
  return { ...smoke, denyHostsFile }
}

function pathsOverlap(left, right) {
  return pathEquals(left, right) || isStrictDescendant(left, right) || isStrictDescendant(right, left)
}

function assertOrdinaryApprovedTestRoot(rawApprovedTestRoot) {
  if (typeof rawApprovedTestRoot !== 'string' || !isAbsolute(rawApprovedTestRoot)) {
    throw new Error('PACKAGED_APP_SMOKE_PATH: smoke test root must be absolute.')
  }
  const approvedTestRoot = resolve(rawApprovedTestRoot)
  if (pathsOverlap(approvedTestRoot, REPOSITORY_ROOT) || pathsOverlap(approvedTestRoot, appExecutable) || pathsOverlap(approvedTestRoot, appArchive)) {
    throw new Error('PACKAGED_APP_SMOKE_PATH: smoke test root must be outside the repository and packaged app paths.')
  }
  for (let current = approvedTestRoot; ; current = dirname(current)) {
    let status
    try {
      status = lstatSync(current)
    } catch {
      throw new Error('PACKAGED_APP_SMOKE_PATH: smoke test root must be an existing ordinary directory.')
    }
    if (!status.isDirectory() || status.isSymbolicLink() || !pathEquals(realpathSync.native(current), current)) {
      throw new Error('PACKAGED_APP_SMOKE_PATH: smoke test root must be an ordinary directory without reparse ancestors.')
    }
    const parent = dirname(current)
    if (pathEquals(parent, current)) return approvedTestRoot
  }
}

export function assertSafeSmokeUserData(rawUserData, rawApprovedTestRoot = TEST_ROOT) {
  const approvedTestRoot = assertOrdinaryApprovedTestRoot(rawApprovedTestRoot)
  if (typeof rawUserData !== 'string' || !isAbsolute(rawUserData)) {
    throw new Error('PACKAGED_APP_SMOKE_PATH: user-data path must be absolute.')
  }
  const userData = resolve(rawUserData)
  const smokeRoot = dirname(userData)
  if (basename(userData) !== 'user-data' || !basename(smokeRoot).startsWith('smoke-') ||
    !pathEquals(dirname(smokeRoot), approvedTestRoot) || !pathEquals(dirname(userData), smokeRoot)) {
    throw new Error('PACKAGED_APP_SMOKE_PATH: user-data must be the exact child of a direct smoke-* directory inside the approved test root.')
  }
  return { userData, smokeRoot, approvedTestRoot }
}

export function buildSmokeLaunchArguments(userData, denyHostsFile, approvedTestRoot = TEST_ROOT) {
  const safe = assertSafeSmokeUserData(userData, approvedTestRoot)
  if (typeof denyHostsFile !== 'string' || !isAbsolute(denyHostsFile)) {
    throw new Error('PACKAGED_APP_SMOKE_DENY_HOSTS_PATH: deny-hosts path must be absolute.')
  }
  return [`--hitmuse-user-data-dir=${safe.userData}`, `--hitmuse-smoke-deny-hosts-file=${resolve(denyHostsFile)}`, `--hitmuse-smoke-test-root=${safe.approvedTestRoot}`, '--disable-gpu']
}

export function assertSmokeRuntimeReadiness(raw) {
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('PACKAGED_APP_RUNTIME_READINESS_INVALID')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== ['engine', 'model', 'schemaVersion'].join('\0') ||
    value.schemaVersion !== 1 || value.engine !== 'ready' || value.model !== 'ready') {
    throw new Error('PACKAGED_APP_RUNTIME_READINESS_INVALID')
  }
  return value
}

async function assertSmokeRuntimeReadinessAbsent(path) {
  try {
    await lstat(path)
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`PACKAGED_APP_RUNTIME_READINESS_STALE: ${path}`)
}

export async function waitForSmokeRuntimeReadiness(path, startedAt, {
  readFile: read = readFile,
  lstat: readLink = lstat,
  stat: readStatus = stat,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
  now = () => Date.now()
} = {}) {
  const deadline = startedAt + 90_000
  for (;;) {
    try {
      const linkStatus = await readLink(path)
      const status = await readStatus(path)
      if (!linkStatus.isFile() || linkStatus.isSymbolicLink() || !pathEquals(await realpath(path), path) || status.size > maxRuntimeReadinessBytes || status.mtimeMs < startedAt - 2_000) {
        throw new Error('PACKAGED_APP_RUNTIME_READINESS_INVALID')
      }
      return assertSmokeRuntimeReadiness(await read(path, 'utf8'))
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    if (now() >= deadline) throw new Error('PACKAGED_APP_RUNTIME_READINESS_TIMEOUT')
    await wait(250)
  }
}

function pathEquals(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

export async function assertSmokePathIntegrity(smoke, { lstat: readLink = lstat, realpath: resolveLink = realpath } = {}) {
  const safe = assertSafeSmokeUserData(smoke.userData, smoke.approvedTestRoot)
  for (let current = safe.smokeRoot; ; current = dirname(current)) {
    try {
      const status = await readLink(current)
      if (status.isSymbolicLink()) {
        throw new Error(`PACKAGED_APP_SMOKE_REPARSE_POINT: ${current}`)
      }
      const identity = await resolveLink(current)
      if (!pathEquals(identity, current)) {
        throw new Error(`PACKAGED_APP_SMOKE_REPARSE_POINT: ${current}`)
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
    if (pathEquals(current, safe.approvedTestRoot)) break
    const parent = dirname(current)
    if (pathEquals(parent, current)) {
      throw new Error(`PACKAGED_APP_SMOKE_PATH: ${safe.approvedTestRoot} is not an existing safe ancestor.`)
    }
  }
  const smokeIdentity = await resolveLink(safe.smokeRoot).catch((error) => {
    if (error && error.code === 'ENOENT') return null
    throw error
  })
  return { ...safe, smokeIdentity }
}

export async function assertPrecreatedSmokeRoot(smoke) {
  const safe = assertSafeSmokeUserData(smoke.userData, smoke.approvedTestRoot)
  if (!pathEquals(smoke.denyHostsFile, join(safe.smokeRoot, 'deny-hosts.json'))) {
    throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID')
  }
  const root = await lstat(safe.smokeRoot)
  if (!root.isDirectory() || root.isSymbolicLink() || !pathEquals(await realpath(safe.smokeRoot), safe.smokeRoot)) {
    throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID')
  }
  const entries = await readdir(safe.smokeRoot, { withFileTypes: true })
  if (entries.length !== 1 || entries[0].name !== 'deny-hosts.json' || !entries[0].isFile() || entries[0].isSymbolicLink()) {
    throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID')
  }
  const denyHosts = await lstat(smoke.denyHostsFile)
  if (!denyHosts.isFile() || denyHosts.isSymbolicLink() || !pathEquals(await realpath(smoke.denyHostsFile), smoke.denyHostsFile)) {
    throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID')
  }
  let policy
  try { policy = JSON.parse(await readFile(smoke.denyHostsFile, 'utf8')) } catch { throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID') }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).sort().join('\0') !== 'hosts\0schemaVersion'
    || policy.schemaVersion !== 1 || !Array.isArray(policy.hosts) || policy.hosts.length !== CANONICAL_SMOKE_DENY_HOSTS.length
    || policy.hosts.some((host, index) => host !== CANONICAL_SMOKE_DENY_HOSTS[index])) {
    throw new Error('PACKAGED_APP_SMOKE_PRECREATED_INVALID')
  }
}

async function acquireSmokeDirectoryLock(smokeRoot, approvedTestRoot) {
  const lock = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', directoryLockScript, '-Directory', smokeRoot, '-TestRoot', approvedTestRoot], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  try {
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error(`PACKAGED_APP_SMOKE_LOCK_TIMEOUT: ${output}`)), 5_000)
      const finish = (callback, value) => { clearTimeout(timer); callback(value) }
      lock.once('error', (error) => finish(rejectReady, error))
      lock.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('LOCK_READY')) finish(resolveReady)
      })
      lock.stderr.on('data', (chunk) => { output += chunk })
      lock.once('exit', (code) => {
        if (!output.includes('LOCK_READY')) finish(rejectReady, new Error(`PACKAGED_APP_SMOKE_LOCK_FAILED: exit=${code} ${output}`))
      })
    })
  } catch (error) {
    await releaseSmokeDirectoryLock(lock)
    throw error
  }
  return lock
}

async function releaseSmokeDirectoryLock(lock) {
  lock.stdin.end()
  if (lock.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => lock.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
    ])
  }
  if (lock.exitCode === null && lock.pid) {
    await execFileAsync('taskkill.exe', ['/PID', String(lock.pid), '/T', '/F']).catch(() => undefined)
  }
}

async function main() {
  const { userData, smokeRoot, denyHostsFile, approvedTestRoot } = parseSmokeArguments(process.argv.slice(2))
  const beforeCreate = await assertSmokePathIntegrity({ userData, smokeRoot, approvedTestRoot })
  if (beforeCreate.smokeIdentity) {
    await assertPrecreatedSmokeRoot({ userData, smokeRoot, denyHostsFile, approvedTestRoot })
  } else {
    await mkdir(smokeRoot)
  }
  const createdSmoke = await assertSmokePathIntegrity({ userData, smokeRoot, approvedTestRoot })
  if (!createdSmoke.smokeIdentity) {
    throw new Error(`PACKAGED_APP_SMOKE_IDENTITY_MISSING: ${smokeRoot}`)
  }
  const directoryLock = await acquireSmokeDirectoryLock(smokeRoot, approvedTestRoot)
  try {
    await access(appExecutable)
    await access(appUpdateConfig)
    const packagedFiles = new Set((await listPackage(appArchive)).map((file) =>
      file.replaceAll('\\', '/').replace(/^\/+/, '')
    ))
    for (const requiredFile of requiredFiles) {
      if (!packagedFiles.has(requiredFile)) {
        throw new Error(`PACKAGED_APP_DEPENDENCY_MISSING: ${requiredFile}`)
      }
    }

    const beforeSpawn = await assertSmokePathIntegrity({ userData, smokeRoot, approvedTestRoot })
    if (!beforeSpawn.smokeIdentity || !pathEquals(beforeSpawn.smokeIdentity, createdSmoke.smokeIdentity)) {
      throw new Error(`PACKAGED_APP_SMOKE_IDENTITY_CHANGED: ${smokeRoot}`)
    }
    const readinessPath = join(userData, runtimeReadinessFilename)
    await assertSmokeRuntimeReadinessAbsent(readinessPath)
    const launchStartedAt = Date.now()
    const child = spawn(appExecutable, [
      ...buildSmokeLaunchArguments(userData, denyHostsFile, approvedTestRoot),
      `--hitmuse-smoke-runtime-readiness-file=${readinessPath}`
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })

    try {
      const result = await Promise.race([
        waitForSmokeRuntimeReadiness(readinessPath, launchStartedAt).then(() => ({ ready: true })),
        new Promise((resolveExit) => child.once('exit', (code) => resolveExit({ ready: false, code })))
      ])
      const mainLog = await readFile(join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')
      const startupFailed = mainLog.includes('Application startup failed')
      if (!result.ready || startupFailed || /Cannot find module|JavaScript error/i.test(output)) {
        throw new Error(`PACKAGED_APP_RUNTIME_READINESS_FAILED: exit=${result.code ?? 'running'} startupLog=${startupFailed} ${output.trim()}`)
      }
      console.log('Verified packaged HitMuse startup, embedded engine health, and bundled model readiness.')
    } finally {
      if (child.pid) {
        await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => undefined)
      }
    }
  } finally {
    await releaseSmokeDirectoryLock(directoryLock)
    console.log(`PACKAGED_APP_SMOKE_RETAINED: ${smokeRoot}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'PACKAGED_APP_SMOKE_FAILED')
    process.exitCode = 1
  })
}
