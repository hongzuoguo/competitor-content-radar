import { execFileSync } from 'node:child_process'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, parse, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const toolName = 'verify-build-context'

export async function verifyBuildContext({
  root = process.cwd(),
  commit,
  manifestPath,
  runGit = runGitCommand
} = {}) {
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    fail('BUILD_CONTEXT_COMMIT: --commit 必须是完整的 40 位 Git SHA。')
  }

  const repositoryRoot = resolve(runGit(root, ['rev-parse', '--show-toplevel']))
  const requestedPath = validateExternalManifestPath(repositoryRoot, manifestPath)
  const head = runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])

  if (head !== commit) {
    fail('BUILD_CONTEXT_COMMIT_MISMATCH: 请求的提交与当前 HEAD 不一致。')
  }
  if (runGit(repositoryRoot, ['status', '--porcelain']) !== '') {
    fail('BUILD_CONTEXT_DIRTY: Git 工作区不干净，请提交或清理所有变更后重试。')
  }

  let packageJson
  try {
    packageJson = JSON.parse(runGit(repositoryRoot, ['show', 'HEAD:package.json']))
  } catch {
    fail('BUILD_CONTEXT_PACKAGE: 无法读取已提交的 package.json。')
  }

  const version = packageJson.version
  const electron = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  if (typeof version !== 'string' || typeof electron !== 'string') {
    fail('BUILD_CONTEXT_PACKAGE: 已提交的 package.json 缺少版本或 Electron 范围。')
  }

  const manifest = {
    commit: head,
    version,
    electron,
    dirty: false,
    generatedAt: new Date().toISOString(),
    tool: toolName
  }
  const outputPath = await resolveExternalManifestPath(repositoryRoot, requestedPath)
  await writeManifestAtomically(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function runGitCommand(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }).trim()
  } catch {
    fail('BUILD_CONTEXT_GIT: 无法读取 Git 提交上下文。')
  }
}

function validateExternalManifestPath(repositoryRoot, manifestPath) {
  if (typeof manifestPath !== 'string' || !isAbsolute(manifestPath)) {
    fail('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。')
  }

  const requestedPath = resolve(manifestPath)
  if (requestedPath === parse(requestedPath).root || isPathInside(repositoryRoot, requestedPath)) {
    fail('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。')
  }
  return requestedPath
}

async function resolveExternalManifestPath(repositoryRoot, requestedPath) {
  let realParent
  try {
    await mkdir(dirname(requestedPath), { recursive: true })
    realParent = await realpath(dirname(requestedPath))
  } catch {
    fail('BUILD_CONTEXT_MANIFEST_WRITE: 无法安全写入仓库外 manifest。')
  }
  const outputPath = resolve(realParent, basename(requestedPath))
  if (outputPath === parse(outputPath).root || isPathInside(repositoryRoot, outputPath)) {
    fail('BUILD_CONTEXT_MANIFEST_PATH: manifest 必须写入仓库外的绝对文件路径。')
  }
  return outputPath
}

function isPathInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === '' || (!pathFromParent.startsWith('..\\') && !pathFromParent.startsWith('../') && pathFromParent !== '..' && !isAbsolute(pathFromParent))
}

async function writeManifestAtomically(outputPath, contents) {
  const temporaryPath = resolve(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, outputPath)
  } catch {
    fail('BUILD_CONTEXT_MANIFEST_WRITE: 无法安全写入仓库外 manifest。')
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function fail(message) {
  throw new Error(message)
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) {
    fail('BUILD_CONTEXT_ARGUMENTS: 必须且只能提供一次 --commit 和 --manifest 参数。')
  }

  const options = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index]
    const value = argumentsList[index + 1]
    if ((option !== '--commit' && option !== '--manifest') || value === undefined || options.has(option)) {
      fail('BUILD_CONTEXT_ARGUMENTS: 必须且只能提供一次 --commit 和 --manifest 参数。')
    }
    options.set(option, value)
  }
  if (!options.has('--commit') || !options.has('--manifest')) {
    fail('BUILD_CONTEXT_ARGUMENTS: 必须且只能提供一次 --commit 和 --manifest 参数。')
  }
  return { commit: options.get('--commit'), manifestPath: options.get('--manifest') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'BUILD_CONTEXT: 无法确认构建上下文。')
    process.exitCode = 1
  })
}

async function main() {
  const { commit, manifestPath } = parseArguments(process.argv.slice(2))
  await verifyBuildContext({ commit, manifestPath })
  console.log('BUILD_CONTEXT_OK: 已确认构建上下文。')
}
