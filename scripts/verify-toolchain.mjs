import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(scriptPath), '..')

const fields = [
  ['platform', 'PLATFORM'],
  ['arch', 'ARCH'],
  ['node', 'NODE'],
  ['npm', 'NPM'],
  ['python', 'PYTHON'],
  ['visualStudio', 'VISUAL_STUDIO'],
  ['msvc', 'MSVC'],
  ['windowsSdk', 'WINDOWS_SDK']
]

const gitleaksContract = {
  version: '8.30.0',
  url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.0/gitleaks_8.30.0_windows_x64.zip',
  size: 8519574,
  sha256: '54fe94f644b832dd08e8c3a5915efb3bfa862386d59fb27ca0792cb687a83573',
  executable: {
    path: 'gitleaks.exe',
    size: 22689792,
    sha256: '9d08e3f5cfb35a98f230b97bcda24f8d3fc66363c91868ffc98dac0afebdcb72'
  }
}

const pipToolsContract = {
  version: '7.6.0',
  url: 'https://files.pythonhosted.org/packages/60/2f/5f434153d2bf85ae8f85826228707e694276b9e73d6d8040433a03ceeea9/pip_tools-7.6.0-py3-none-any.whl',
  size: 74337,
  sha256: '4bd99155b6d8de358a214b0865e1a2855a453570c1a83d40f7b564870b8657be',
  wheel: 'pip_tools-7.6.0-py3-none-any.whl'
}

export function verifyGitleaksContract(gitleaks) {
  if (!gitleaks ||
    gitleaks.version !== gitleaksContract.version ||
    gitleaks.url !== gitleaksContract.url ||
    gitleaks.size !== gitleaksContract.size ||
    gitleaks.sha256 !== gitleaksContract.sha256 ||
    !/^[a-f0-9]{64}$/.test(gitleaks.sha256) ||
    !gitleaks.executable ||
    gitleaks.executable.path !== gitleaksContract.executable.path ||
    gitleaks.executable.size !== gitleaksContract.executable.size ||
    gitleaks.executable.sha256 !== gitleaksContract.executable.sha256 ||
    !/^[a-f0-9]{64}$/.test(gitleaks.executable.sha256)) {
    throw new Error('TOOLCHAIN_GITLEAKS_CONTRACT_INVALID')
  }
  return { ...gitleaks }
}

export function verifyPipToolsContract(pipTools) {
  if (!pipTools ||
    pipTools.version !== pipToolsContract.version ||
    pipTools.url !== pipToolsContract.url ||
    pipTools.size !== pipToolsContract.size ||
    pipTools.sha256 !== pipToolsContract.sha256 ||
    pipTools.wheel !== pipToolsContract.wheel ||
    !/^[a-f0-9]{64}$/.test(pipTools.sha256)) {
    throw new Error('TOOLCHAIN_PIP_TOOLS_CONTRACT_INVALID')
  }
  return { ...pipTools }
}

export function verifyToolchainSnapshot({ contract, actual, lockedPackages }) {
  if (contract?.schemaVersion !== 1) throw new Error('TOOLCHAIN_CONTRACT_INVALID')
  verifyGitleaksContract(contract.gitleaks)
  verifyPipToolsContract(contract.pipTools)
  for (const [field, label] of fields) {
    if (actual?.[field] !== contract[field]) {
      throw new Error(`TOOLCHAIN_${label}_MISMATCH:expected=${contract[field]}:actual=${actual?.[field] ?? 'missing'}`)
    }
  }
  for (const [name, expected] of Object.entries(contract.lockedPackages ?? {})) {
    const actualVersion = lockedPackages?.[name]
    if (actualVersion !== expected) {
      throw new Error(`TOOLCHAIN_LOCKED_PACKAGE_MISMATCH:${name}:expected=${expected}:actual=${actualVersion ?? 'missing'}`)
    }
  }
  return { ...actual, lockedPackages: { ...lockedPackages } }
}

function commandVersion(file, args, pattern, code) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`${code}_UNAVAILABLE`)
  const value = `${result.stdout}${result.stderr}`.match(pattern)?.[1]
  if (!value) throw new Error(`${code}_INVALID`)
  return value
}

async function newestDirectory(path, code) {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    throw new Error(`${code}_UNAVAILABLE`)
  }
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  if (names.length === 0) throw new Error(`${code}_UNAVAILABLE`)
  return names.at(-1)
}

async function readLockedPackages(root, names) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  return Object.fromEntries(names.map((name) => [name, lock.packages?.[`node_modules/${name}`]?.version]))
}

async function collectActualToolchain(root, contract) {
  if (process.platform !== 'win32') {
    return { platform: process.platform, arch: process.arch }
  }
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (!programFilesX86) throw new Error('TOOLCHAIN_VISUAL_STUDIO_UNAVAILABLE')
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const vsResult = spawnSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-format', 'json'
  ], { encoding: 'utf8', windowsHide: true })
  if (vsResult.status !== 0) throw new Error('TOOLCHAIN_VISUAL_STUDIO_UNAVAILABLE')
  const instances = JSON.parse(vsResult.stdout)
  const installation = instances[0]
  if (!installation?.installationPath || !installation?.installationVersion) {
    throw new Error('TOOLCHAIN_VISUAL_STUDIO_UNAVAILABLE')
  }
  const msvc = await newestDirectory(join(installation.installationPath, 'VC', 'Tools', 'MSVC'), 'TOOLCHAIN_MSVC')
  const windowsSdk = await newestDirectory(join(programFilesX86, 'Windows Kits', '10', 'Include'), 'TOOLCHAIN_WINDOWS_SDK')
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    npm: commandVersion(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm --version'], /([0-9]+\.[0-9]+\.[0-9]+)/, 'TOOLCHAIN_NPM'),
    python: commandVersion('python.exe', ['--version'], /Python ([0-9]+\.[0-9]+\.[0-9]+)/, 'TOOLCHAIN_PYTHON'),
    visualStudio: installation.installationVersion,
    msvc,
    windowsSdk,
    contract
  }
}

async function main() {
  const contract = JSON.parse(await readFile(join(projectRoot, 'resources', 'build-toolchain.json'), 'utf8'))
  const actual = await collectActualToolchain(projectRoot, contract)
  const lockedPackages = await readLockedPackages(projectRoot, Object.keys(contract.lockedPackages))
  const result = verifyToolchainSnapshot({ contract, actual, lockedPackages })
  console.log(`Verified HitMuse toolchain: Node ${result.node}, npm ${result.npm}, Electron ${result.lockedPackages.electron}`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'TOOLCHAIN_VERIFICATION_FAILED')
    process.exitCode = 1
  })
}
