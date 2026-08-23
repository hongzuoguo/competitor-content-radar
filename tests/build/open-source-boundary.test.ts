import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const thisTest = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(thisTest, '..', '..', '..')
const obsoleteAccessTerm = Buffer.from('YmlsbGluZw==', 'base64').toString('utf8')
const boundaryPattern = `${obsoleteAccessTerm}[-_ ]?(gate|bootstrap|required)|MAIN_VITE_${obsoleteAccessTerm.toUpperCase()}|verify:${obsoleteAccessTerm}`
const obsoleteScriptKey = ['verify', `${obsoleteAccessTerm}-bootstrap`].join(':')

describe('open-source boundary', () => {
  it('contains no obsolete access implementation or configuration', () => {
    const scan = spawnSync('git.exe', [
      'grep', '-I', '-l', '-E', boundaryPattern, '--', '.', ':(exclude)tests/build/open-source-boundary.test.ts'
    ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })

    if (scan.error) throw scan.error
    if ((scan.status ?? 2) > 1) throw new Error(`OPEN_SOURCE_BOUNDARY_SCAN_FAILED:${scan.status}`)
    if (scan.status === 0) throw new Error(`OPEN_SOURCE_BOUNDARY_MATCHES:${scan.stdout.trim()}`)
    expect(scan.status).toBe(1)
    expect(scan.stdout).toBe('')

    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(packageJson.scripts[obsoleteScriptKey]).toBeUndefined()
    expect(readFileSync(resolve(repositoryRoot, 'electron.vite.config.ts'), 'utf8')).not.toContain(`MAIN_VITE_${obsoleteAccessTerm.toUpperCase()}_`)
  })
})
