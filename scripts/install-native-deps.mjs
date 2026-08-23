import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(scriptPath), '..')
const require = createRequire(import.meta.url)

export function installNativeDependencies({
  runtime = process.env.HITMUSE_INSTALL_RUNTIME,
  run = spawnSync,
  nodePath = process.execPath,
  electronInstallPath = require.resolve('electron/install.js'),
  electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js'),
  root = projectRoot
} = {}) {
  const requestedRuntime = runtime || 'node'
  if (requestedRuntime !== 'node' && requestedRuntime !== 'electron') {
    throw new Error(`原生依赖安装环境无效：${requestedRuntime}。只允许 node 或 electron。`)
  }

  const electronResult = run(nodePath, [electronInstallPath], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (electronResult?.status !== 0) {
    throw new Error(`Electron 运行时安装失败，退出码：${electronResult?.status ?? 'unknown'}。`)
  }
  if (requestedRuntime === 'node') {
    console.log('[native-install] Node 开发环境：Electron 运行时已安装，原生模块保留 Node ABI。')
    return { runtime: 'node' }
  }

  const result = run(nodePath, [electronBuilderCli, 'install-app-deps'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result?.status !== 0) {
    throw new Error(`Electron 原生依赖安装失败，退出码：${result?.status ?? 'unknown'}。`)
  }
  console.log('[native-install] 临时打包环境：Electron 原生依赖已经准备完成。')
  return { runtime: 'electron' }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    installNativeDependencies()
  } catch (error) {
    console.error(error instanceof Error ? error.message : '原生依赖安装失败。')
    process.exitCode = 1
  }
}
