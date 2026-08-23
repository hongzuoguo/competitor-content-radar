import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as abi from '../../scripts/switch-abi.mjs'
import { installNativeDependencies } from '../../scripts/install-native-deps.mjs'
import { verifyNativeRuntime } from '../../scripts/verify-native-runtime.mjs'

const execFileAsync = promisify(execFile)
const buildContextVerifier = resolve(process.cwd(), 'scripts', 'verify-build-context.mjs')

const scriptSource = await readFile('scripts/switch-abi.mjs', 'utf8')

const buildTools = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools'
const compatibleVswhereOutput = `${buildTools}\\\r\n`
const msvcEnvironmentOutput = [
  `VCINSTALLDIR=${buildTools}\\VC\\`,
  'VSCMD_VER=17.14.35207.0',
  'WindowsSDKVersion=10.0.26100.0\\',
  'IGNORED=value'
].join('\r\n')

describe('native rebuild build context', () => {
  it('keeps the ABI helper importable by Vitest', () => {
    expect(scriptSource.startsWith('#!')).toBe(false)
  })

  it('does not pin Electron or Node ABI versions in the rebuild script', () => {
    expect(scriptSource).not.toContain('Electron 43')
    expect(scriptSource).not.toContain('ABI 148')
    expect(scriptSource).not.toContain('ABI 137')
  })

  it('derives the Electron version from electron/package.json', () => {
    const readFile = vi.fn(() => JSON.stringify({ version: '43.1.0' }))

    expect(abi.getElectronVersion(readFile, 'C:\\project')).toBe('43.1.0')
    expect(readFile).toHaveBeenCalledWith('C:\\project\\node_modules\\electron\\package.json', 'utf8')
  })

  it('uses the running Node ABI instead of a pinned value', () => {
    expect(abi.getNodeAbi({ modules: '137' })).toBe('137')
  })

  it('keeps every native rebuild dependency in one shared list', () => {
    expect(abi.nativeDependencies).toEqual(['better-sqlite3', 'nodejieba'])
  })

  it('parses compatible Visual Studio installation paths reported by vswhere', () => {
    expect(abi.parseVswhereInstallations(compatibleVswhereOutput)).toEqual([
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools'
    ])
  })

  it('captures vswhere and vcvars output through the default capture runner', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: compatibleVswhereOutput })
      .mockReturnValueOnce({ status: 0, stdout: msvcEnvironmentOutput })
    const { run, capture } = abi.createRunners({
      spawn,
      projectRoot: 'C:\\project',
      baseEnvironment: { EXISTING: 'value' }
    })

    expect(abi.discoverMsvcEnvironment({ capture, vswherePath: 'C:\\vswhere.exe' })).toEqual(expect.objectContaining({
      VCINSTALLDIR: `${buildTools}\\VC\\`
    }))
    expect(spawn).toHaveBeenNthCalledWith(1, 'C:\\vswhere.exe', expect.any(Array), expect.objectContaining({
      cwd: 'C:\\project',
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true
    }))
    expect(spawn.mock.calls[0][2]).not.toHaveProperty('windowsVerbatimArguments')
    expect(spawn).toHaveBeenNthCalledWith(2, 'cmd.exe', expect.any(Array), expect.objectContaining({
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      windowsVerbatimArguments: true
    }))
    run('C:\\node\\node.exe', ['node-gyp.js'], { VCINSTALLDIR: `${buildTools}\\VC\\` })
    expect(spawn).toHaveBeenNthCalledWith(3, 'C:\\node\\node.exe', ['node-gyp.js'], expect.objectContaining({
      stdio: 'inherit',
      windowsHide: true
    }))
  })

  it('keeps capture invariants when callers request verbatim arguments', () => {
    const spawn = vi.fn()
    const { capture } = abi.createRunners({
      spawn,
      projectRoot: 'C:\\project',
      baseEnvironment: { EXISTING: 'value' }
    })

    capture('cmd.exe', ['/d', '/c', 'set'], { PROVIDED: 'value' }, {
      cwd: 'C:\\unexpected',
      env: {},
      stdio: 'inherit',
      encoding: null,
      windowsHide: false,
      windowsVerbatimArguments: true
    })

    expect(spawn).toHaveBeenCalledWith('cmd.exe', ['/d', '/c', 'set'], {
      cwd: 'C:\\project',
      env: { EXISTING: 'value', PROVIDED: 'value' },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      windowsVerbatimArguments: true
    })
  })

  it.skipIf(process.platform !== 'win32')('captures vcvars output from a temporary path with spaces', async () => {
    const toolchainRoot = await mkdtemp(join(tmpdir(), 'switch abi vcvars path with spaces-'))
    temporaryDirectories.push(toolchainRoot)
    const installationPath = join(toolchainRoot, 'Visual Studio Build Tools')
    const vcvars = join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    await mkdir(join(installationPath, 'VC', 'Auxiliary', 'Build'), { recursive: true })
    await writeFile(vcvars, '@echo off\r\nset VCINSTALLDIR=temporary-toolchain\r\n')

    const { capture } = abi.createRunners({ projectRoot: toolchainRoot })
    let vcvarsResult: ReturnType<typeof capture> | undefined
    const discoverCapture: typeof capture = (command, args, environment, spawnOptions) => {
      if (command === 'test-vswhere.exe') return { status: 0, stdout: `${installationPath}\r\n` }
      vcvarsResult = capture(command, args, environment, spawnOptions)
      return vcvarsResult
    }

    expect(abi.discoverMsvcEnvironment({ capture: discoverCapture, vswherePath: 'test-vswhere.exe' })).toEqual(expect.objectContaining({
      VCINSTALLDIR: 'temporary-toolchain'
    }))
    expect(vcvarsResult?.status).toBe(0)
  })

  it('derives MSVC variables only from a compatible Visual Studio installation', () => {
    const run = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: compatibleVswhereOutput })
      .mockReturnValueOnce({ status: 0, stdout: msvcEnvironmentOutput })

    expect(abi.discoverMsvcEnvironment({ capture: run, vswherePath: 'C:\\vswhere.exe' })).toEqual({
      VCINSTALLDIR: `${buildTools}\\VC\\`,
      VSCMD_VER: '17.14.35207.0',
      WindowsSDKVersion: '10.0.26100.0\\'
    })
    expect(run).toHaveBeenNthCalledWith(1, 'C:\\vswhere.exe', expect.arrayContaining([
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
    ]))
    expect(run).toHaveBeenNthCalledWith(2, 'cmd.exe', expect.arrayContaining([
      expect.stringContaining(`${buildTools}\\VC\\Auxiliary\\Build\\vcvars64.bat`)
    ]), undefined, { windowsVerbatimArguments: true })
  })

  it('fails with an actionable Chinese error when no compatible C++ toolchain is discovered', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '' }))

    expect(() => abi.discoverMsvcEnvironment({ capture: run, vswherePath: 'C:\\vswhere.exe' }))
      .toThrow('\u672a\u627e\u5230\u53ef\u7528\u7684 Visual Studio C++ \u5de5\u5177\u94fe\u3002\u8bf7\u5b89\u88c5 Visual Studio Build Tools\uff0c\u5e76\u52fe\u9009\u201c\u4f7f\u7528 C++ \u7684\u684c\u9762\u5f00\u53d1\u201d\u3002')
  })

  it('passes the discovered Electron version to every Electron rebuild', () => {
    const run = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: compatibleVswhereOutput })
      .mockReturnValueOnce({ status: 0, stdout: msvcEnvironmentOutput })
      .mockReturnValue({ status: 0, stdout: '' })
    const removeBuild = vi.fn()

    abi.runSwitchAbi('electron', {
      root: 'C:\\project',
      readFile: () => JSON.stringify({ version: '43.1.0' }),
      run,
      capture: run,
      vswherePath: 'C:\\vswhere.exe',
      nodePath: 'C:\\node\\node.exe',
      nodeAbi: '137',
      removeBuild
    })

    expect(run.mock.calls.slice(2)).toHaveLength(abi.nativeDependencies.length)
    for (const [, args] of run.mock.calls.slice(2)) {
      expect(args).toEqual(expect.arrayContaining(['-v', '43.1.0', '-f']))
    }
    expect(removeBuild).not.toHaveBeenCalled()
  })

  it('rebuilds Node dependencies with the current Node and local node-gyp', () => {
    const run = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: compatibleVswhereOutput })
      .mockReturnValueOnce({ status: 0, stdout: msvcEnvironmentOutput })
      .mockReturnValue({ status: 0, stdout: '' })
    const removeBuild = vi.fn()

    abi.runSwitchAbi('node', {
      root: 'C:\\project',
      run,
      capture: run,
      vswherePath: 'C:\\vswhere.exe',
      nodePath: 'C:\\node\\node.exe',
      nodeAbi: '137',
      removeBuild
    })

    expect(removeBuild).toHaveBeenCalledTimes(abi.nativeDependencies.length)
    expect(run.mock.calls.slice(2)).toEqual(expect.arrayContaining([
      ['C:\\node\\node.exe', expect.arrayContaining([
        'C:\\project\\node_modules\\node-gyp\\bin\\node-gyp.js',
        'rebuild',
        '--build-from-source'
      ]), expect.any(Object)]
    ]))
  })
})

describe('runtime-isolated native dependency setup', () => {
  it('installs the pinned Electron runtime while keeping ordinary native modules on the Node ABI', () => {
    const run = vi.fn(() => ({ status: 0 }))

    expect(installNativeDependencies({ runtime: undefined, run, electronInstallPath: 'C:\\project\\node_modules\\electron\\install.js' }))
      .toEqual({ runtime: 'node' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.any(String), ['C:\\project\\node_modules\\electron\\install.js'], expect.objectContaining({
      stdio: 'inherit',
      windowsHide: true,
    }))
  })

  it('prepares Electron native dependencies exactly once for a packaging install', () => {
    const run = vi.fn(() => ({ status: 0 }))

    expect(installNativeDependencies({ runtime: 'electron', run, electronInstallPath: 'C:\\project\\node_modules\\electron\\install.js' }))
      .toEqual({ runtime: 'electron' })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]).toEqual([expect.any(String), ['C:\\project\\node_modules\\electron\\install.js'], expect.objectContaining({
      stdio: 'inherit',
      windowsHide: true,
    })])
    expect(run.mock.calls[1]).toEqual([expect.any(String), expect.arrayContaining(['install-app-deps']), expect.objectContaining({
      stdio: 'inherit',
      windowsHide: true,
    })])
  })

  it('rejects unknown install runtime markers', () => {
    expect(() => installNativeDependencies({ runtime: 'unexpected', run: vi.fn() }))
      .toThrow('原生依赖安装环境无效')
  })

  it.each([
    ['node', { node: '24.14.1', modules: '137' }],
    ['electron', { node: '24.14.1', modules: '148', electron: '43.1.0' }],
  ] as const)('performs real dependency operations for the expected %s runtime', (expectedRuntime, versions) => {
    const close = vi.fn()
    const get = vi.fn(() => ({ ok: 1 }))
    const prepare = vi.fn(() => ({ get }))
    class Database {
      prepare = prepare
      close = close
    }
    const cut = vi.fn(() => ['原生', '模块'])

    expect(verifyNativeRuntime({ expectedRuntime, versions, Database, jieba: { cut } })).toEqual({
      runtime: expectedRuntime,
      node: versions.node,
      modules: versions.modules,
      electron: 'electron' in versions ? versions.electron : null,
      dependencies: ['better-sqlite3', 'nodejieba'],
    })
    expect(prepare).toHaveBeenCalledWith('SELECT 1 AS ok')
    expect(get).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(cut).toHaveBeenCalledWith('原生模块运行检查')
  })

  it('rejects a runtime that does not match the requested ABI environment', () => {
    const dependencies = {
      Database: vi.fn(() => ({ prepare: () => ({ get: () => ({ ok: 1 }) }), close: vi.fn() })),
      jieba: { cut: () => ['检查'] },
    }

    expect(() => verifyNativeRuntime({ expectedRuntime: 'electron', versions: { node: '24.14.1', modules: '137' }, ...dependencies }))
      .toThrow('期望 Electron 运行环境')
    expect(() => verifyNativeRuntime({ expectedRuntime: 'node', versions: { node: '24.14.1', modules: '148', electron: '43.1.0' }, ...dependencies }))
      .toThrow('期望 Node 运行环境')
  })
})

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createBuildContextRepository(packageJson = {
  version: '1.0.5',
  devDependencies: { electron: '^43.1.0' }
}): Promise<{ root: string, commit: string }> {
  const root = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-context-'))
  temporaryDirectories.push(root)
  await runGit(root, ['init'])
  await runGit(root, ['config', 'user.email', 'build-context@example.test'])
  await runGit(root, ['config', 'user.name', 'Build Context Test'])
  await writeFile(join(root, 'package.json'), JSON.stringify(packageJson, null, 2))
  await runGit(root, ['add', 'package.json'])
  await runGit(root, ['commit', '-m', 'initial build context'])
  const { stdout } = await runGit(root, ['rev-parse', 'HEAD'])
  return { root, commit: stdout.trim() }
}

function runGit(cwd: string, args: string[]) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
}

function runBuildContextVerifier(cwd: string, commit: string, manifest: string) {
  return runBuildContextCli(cwd, ['--commit', commit, '--manifest', manifest])
}

function runBuildContextCli(cwd: string, args: string[]) {
  return execFileAsync(process.execPath, [buildContextVerifier, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
}

describe('release build context gate', () => {
  it('writes a manifest for the exact clean commit outside the repository', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)
    const manifestPath = join(artifacts, 'provenance', 'build-context.json')

    await expect(runBuildContextVerifier(root, commit, manifestPath)).resolves.toMatchObject({
      stdout: expect.stringContaining('BUILD_CONTEXT_OK: 已确认构建上下文。')
    })

    await expect(readFile(manifestPath, 'utf8')).resolves.toEqual(expect.any(String))
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(manifest).toEqual({
      commit,
      version: '1.0.5',
      electron: '^43.1.0',
      dirty: false,
      generatedAt: expect.any(String),
      tool: 'verify-build-context',
    })
    expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt)
    await expect(readdir(join(artifacts, 'provenance'))).resolves.toEqual(['build-context.json'])
  })

  it('rejects tracked working-tree changes', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)
    await writeFile(join(root, 'package.json'), '{"version":"9.9.9"}')

    await expect(runBuildContextVerifier(root, commit, join(artifacts, 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_DIRTY: Git 工作区不干净，请提交或清理所有变更后重试。') })
  })

  it('rejects untracked source-like files', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'uncommitted.ts'), 'export const uncommitted = true\n')

    await expect(runBuildContextVerifier(root, commit, join(artifacts, 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_DIRTY: Git 工作区不干净，请提交或清理所有变更后重试。') })
  })

  it('rejects a requested commit that does not match HEAD', async () => {
    const { root } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)

    await expect(runBuildContextVerifier(root, '0'.repeat(40), join(artifacts, 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_COMMIT_MISMATCH: 请求的提交与当前 HEAD 不一致。') })
  })

  it.each([
    ['relative path', 'build-context.json'],
    ['filesystem root', resolve(process.cwd()).slice(0, 3)]
  ])('rejects a %s manifest destination', async (_label, unsafeManifestPath) => {
    const { root, commit } = await createBuildContextRepository()

    await expect(runBuildContextVerifier(root, commit, unsafeManifestPath))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。') })
  })

  it('rejects an absolute manifest destination inside the repository', async () => {
    const { root, commit } = await createBuildContextRepository()

    await expect(runBuildContextVerifier(root, commit, join(root, 'release', 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。') })
    await expect(runGit(root, ['status', '--porcelain'])).resolves.toMatchObject({ stdout: '' })
  })

  it('allows an external manifest path with a similar repository prefix', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = `${root}-artifacts`
    temporaryDirectories.push(artifacts)
    const manifestPath = join(artifacts, 'build-context.json')

    await expect(runBuildContextVerifier(root, commit, manifestPath)).resolves.toMatchObject({
      stdout: expect.stringContaining('BUILD_CONTEXT_OK: 已确认构建上下文。')
    })
    await expect(readFile(manifestPath, 'utf8')).resolves.toEqual(expect.any(String))
    await expect(runGit(root, ['status', '--porcelain'])).resolves.toMatchObject({ stdout: '' })
  })

  it('rejects an external manifest parent junction that resolves into the repository', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)
    const repositoryLink = join(artifacts, 'repository-link')
    await symlink(root, repositoryLink, 'junction')

    await expect(runBuildContextVerifier(root, commit, join(repositoryLink, 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。') })
    await expect(runGit(root, ['status', '--porcelain'])).resolves.toMatchObject({ stdout: '' })
  })

  it('does not create an external manifest parent when commit, dirty, or package validation fails', async () => {
    const mismatch = await createBuildContextRepository()
    const dirty = await createBuildContextRepository()
    const invalidPackage = await createBuildContextRepository({ version: '1.0.5' })
    await writeFile(join(dirty.root, 'package.json'), '{"version":"9.9.9"}')
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)

    await expect(runBuildContextVerifier(mismatch.root, '0'.repeat(40), join(artifacts, 'mismatch', 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_COMMIT_MISMATCH: 请求的提交与当前 HEAD 不一致。') })
    await expect(runBuildContextVerifier(dirty.root, dirty.commit, join(artifacts, 'dirty', 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_DIRTY: Git 工作区不干净，请提交或清理所有变更后重试。') })
    await expect(runBuildContextVerifier(invalidPackage.root, invalidPackage.commit, join(artifacts, 'package', 'build-context.json')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_PACKAGE: 已提交的 package.json 缺少版本或 Electron 范围。') })
    await expect(readdir(artifacts)).resolves.toEqual([])
  }, 30_000)

  it('rejects malformed CLI option sets without writing a manifest', async () => {
    const { root, commit } = await createBuildContextRepository()
    const artifacts = await mkdtemp(join(tmpdir(), 'competitor-content-radar-build-artifacts-'))
    temporaryDirectories.push(artifacts)
    const manifestPath = join(artifacts, 'not-created', 'build-context.json')

    for (const args of [
      ['--manifest', manifestPath],
      ['--commit', commit],
      ['--commit', commit, '--commit', commit, '--manifest', manifestPath],
      ['--commit', commit, '--manifest', manifestPath, '--manifest', manifestPath],
      ['--commit', commit, '--manifest', manifestPath, '--unknown', 'value'],
      ['--commit', commit, '--manifest']
    ]) {
      await expect(runBuildContextCli(root, args))
        .rejects.toMatchObject({ stderr: expect.stringContaining('BUILD_CONTEXT_ARGUMENTS: 必须且只能提供一次 --commit 和 --manifest 参数。') })
      await expect(readdir(artifacts)).resolves.toEqual([])
    }
  })
})
