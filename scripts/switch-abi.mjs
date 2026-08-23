/**
 * Switch native dependencies between the current Node and Electron runtimes.
 *
 * Usage:
 *   node scripts/switch-abi.mjs electron
 *   node scripts/switch-abi.mjs node
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const root = join(dirname(scriptPath), '..')
const toolchainError = '\u672a\u627e\u5230\u53ef\u7528\u7684 Visual Studio C++ \u5de5\u5177\u94fe\u3002\u8bf7\u5b89\u88c5 Visual Studio Build Tools\uff0c\u5e76\u52fe\u9009\u201c\u4f7f\u7528 C++ \u7684\u684c\u9762\u5f00\u53d1\u201d\u3002'

export const nativeDependencies = ['better-sqlite3', 'nodejieba']

export function getElectronVersion (readFile = readFileSync, projectRoot = root) {
  const packagePath = join(projectRoot, 'node_modules', 'electron', 'package.json')
  const electronPackage = JSON.parse(readFile(packagePath, 'utf8'))
  if (typeof electronPackage.version !== 'string' || electronPackage.version.length === 0) {
    throw new Error(`Electron package version is missing: ${packagePath}`)
  }
  return electronPackage.version
}

export function getNodeAbi (versions = process.versions) {
  if (typeof versions.modules !== 'string' || versions.modules.length === 0) {
    throw new Error('\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d Node ABI\uff08process.versions.modules\uff09\u3002')
  }
  return versions.modules
}

export function parseVswhereInstallations (output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean)
}

function parseMsvcEnvironment (output) {
  const variableNames = new Set([
    'INCLUDE', 'LIB', 'LIBPATH', 'PATH', 'UCRTVERSION', 'VCINSTALLDIR',
    'VCTOOLSINSTALLDIR', 'VCTOOLSVERSION', 'VSCMD_VER', 'WINDOWSSDKDIR',
    'WINDOWSSDKVERSION'
  ])
  const environment = {}
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const name = line.slice(0, separator)
    if (variableNames.has(name.toUpperCase())) {
      environment[name] = line.slice(separator + 1)
    }
  }
  return environment
}

function defaultVswherePath (environment = process.env) {
  return join(
    environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
  )
}

export function createRunners ({ spawn = spawnSync, projectRoot = root, baseEnvironment = process.env } = {}) {
  const run = (command, args, environment) => spawn(command, args, {
    cwd: projectRoot,
    env: { ...baseEnvironment, ...environment },
    stdio: 'inherit',
    windowsHide: true
  })
  const capture = (command, args, environment, { windowsVerbatimArguments } = {}) => spawn(command, args, {
    cwd: projectRoot,
    env: { ...baseEnvironment, ...environment },
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    ...(typeof windowsVerbatimArguments === 'boolean' ? { windowsVerbatimArguments } : {})
  })
  return { run, capture }
}

const { run: defaultRun, capture: defaultCapture } = createRunners()

export function discoverMsvcEnvironment ({ capture = defaultCapture, vswherePath = defaultVswherePath() } = {}) {
  const discovery = capture(vswherePath, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath', '-format', 'value'
  ])
  const installationPath = discovery?.status === 0
    ? parseVswhereInstallations(discovery.stdout)[0]
    : undefined
  if (!installationPath) throw new Error(toolchainError)

  const vcvars = join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  const initialized = capture('cmd.exe', ['/d', '/s', '/c', `call "${vcvars}" >nul && set`], undefined, {
    windowsVerbatimArguments: true
  })
  const environment = initialized?.status === 0 ? parseMsvcEnvironment(initialized.stdout) : {}
  if (!environment.VCINSTALLDIR) throw new Error(toolchainError)
  return environment
}

function runChecked (run, command, args, environment) {
  const result = run(command, args, environment)
  if (result?.status !== 0) {
    throw new Error(`[switch-abi] Command failed: ${command}`)
  }
}

export function runSwitchAbi (mode, {
  root: projectRoot = root,
  readFile = readFileSync,
  run = defaultRun,
  capture = defaultCapture,
  vswherePath,
  nodePath = process.execPath,
  nodeAbi = getNodeAbi(),
  removeBuild = rmSync
} = {}) {
  if (mode !== 'electron' && mode !== 'node') {
    throw new Error('Usage: node scripts/switch-abi.mjs <electron|node>')
  }

  const msvcEnvironment = discoverMsvcEnvironment({ capture, vswherePath })
  if (mode === 'electron') {
    const electronVersion = getElectronVersion(readFile, projectRoot)
    for (const dependency of nativeDependencies) {
      console.log(`[switch-abi] Rebuilding ${dependency} for Electron ${electronVersion}...`)
      runChecked(run, nodePath, [
        join(projectRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
        '-v', electronVersion, '-f', '-o', dependency
      ], msvcEnvironment)
    }
    console.log(`[switch-abi] Done: native dependencies now target Electron ${electronVersion}`)
    return
  }

  for (const dependency of nativeDependencies) {
    console.log(`[switch-abi] Rebuilding ${dependency} for Node (ABI ${nodeAbi})...`)
    removeBuild(join(projectRoot, 'node_modules', dependency, 'build'), { recursive: true, force: true })
    runChecked(run, nodePath, [
      join(projectRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
      'rebuild', '--build-from-source', `--directory=node_modules/${dependency}`
    ], msvcEnvironment)
  }
  console.log(`[switch-abi] Done: native dependencies now target Node (ABI ${nodeAbi})`)
}

export function main (argv = process.argv.slice(2)) {
  return runSwitchAbi(argv[0])
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
