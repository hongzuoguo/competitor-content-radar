import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const require = createRequire(import.meta.url)

export function verifyNativeRuntime({ expectedRuntime, versions, Database, jieba }) {
  if (expectedRuntime !== 'node' && expectedRuntime !== 'electron') {
    throw new Error(`原生模块运行环境无效：${expectedRuntime}。`)
  }
  const actualRuntime = versions?.electron ? 'electron' : 'node'
  if (actualRuntime !== expectedRuntime) {
    const expectedLabel = expectedRuntime === 'electron' ? 'Electron' : 'Node'
    throw new Error(`期望 ${expectedLabel} 运行环境，但当前实际为 ${actualRuntime === 'electron' ? 'Electron' : 'Node'}。`)
  }
  if (typeof versions?.node !== 'string' || typeof versions?.modules !== 'string') {
    throw new Error('无法读取当前运行时的 Node 版本或 ABI。')
  }

  let database
  try {
    database = new Database(':memory:')
    const result = database.prepare('SELECT 1 AS ok').get()
    if (result?.ok !== 1) throw new Error('内存数据库查询结果异常。')
  } catch (error) {
    throw new Error(`better-sqlite3 无法在当前 ${actualRuntime} 环境运行。`, { cause: error })
  } finally {
    database?.close?.()
  }

  try {
    const tokens = jieba.cut('原生模块运行检查')
    if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('分词结果为空。')
  } catch (error) {
    throw new Error(`nodejieba 无法在当前 ${actualRuntime} 环境运行。`, { cause: error })
  }

  return {
    runtime: actualRuntime,
    node: versions.node,
    modules: versions.modules,
    electron: versions.electron ?? null,
    dependencies: ['better-sqlite3', 'nodejieba']
  }
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) {
    throw new Error('原生模块检查参数错误：必须提供一次 --runtime 和一次 --result。')
  }
  const options = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index]
    const value = argumentsList[index + 1]
    if ((option !== '--runtime' && option !== '--result') || !value || options.has(option)) {
      throw new Error('原生模块检查参数错误：必须提供一次 --runtime 和一次 --result。')
    }
    options.set(option, value)
  }
  const expectedRuntime = options.get('--runtime')
  const resultPath = options.get('--result')
  if ((expectedRuntime !== 'node' && expectedRuntime !== 'electron') || !isAbsolute(resultPath)) {
    throw new Error('原生模块检查参数错误：runtime 只能是 node/electron，result 必须是绝对路径。')
  }
  return { expectedRuntime, resultPath: resolve(resultPath) }
}

async function writeResultAtomically(resultPath, result) {
  await mkdir(dirname(resultPath), { recursive: true })
  const temporaryPath = `${resultPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, resultPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function main() {
  const { expectedRuntime, resultPath } = parseArguments(process.argv.slice(2))
  const result = verifyNativeRuntime({
    expectedRuntime,
    versions: process.versions,
    Database: require('better-sqlite3'),
    jieba: require('nodejieba')
  })
  await writeResultAtomically(resultPath, result)
  console.log(`原生模块检查通过：${result.runtime} ABI ${result.modules}。`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : '原生模块检查失败。')
    process.exitCode = 1
  })
}
