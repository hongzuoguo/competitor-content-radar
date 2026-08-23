import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const thisTest = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(thisTest, '..', '..', '..')

const privatePaths = [
  'AGENTS.md',
  'DESIGN.md',
  'PRODUCT.md',
  'design-system/hitmuse/MASTER.md',
  'docs/2026-08-09-architecture-and-packaging-lessons.md',
  'docs/operations/repository-content-policy.md',
  'docs/releases/0.3.1.md',
  'scripts/archive-and-clean-history.ps1',
  'tests/build/archive-clean-history.test.ts',
]

const restrictiveUseTerm = '\u7981\u6b62\u5546\u7528'

describe('public repository boundary', () => {
  it('excludes private repository materials', () => {
    const trackedPaths = new Set(execFileSync('git.exe', ['ls-files', '-z'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).split('\0').filter(Boolean))

    for (const relativePath of privatePaths) {
      expect(trackedPaths.has(relativePath), relativePath).toBe(false)
    }
    expect([...trackedPaths].some((relativePath) => relativePath.startsWith('docs/superpowers/'))).toBe(false)
  })

  it('packages only the public runtime contract and retains the fixed Feishu template', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      build: { files: string[] }
    }

    expect(packageJson.build.files).toEqual([
      'out/**/*',
      'resources/model-manifest.json',
      'package.json',
    ])
    expect(packageJson.build.files).not.toContain('tests/**/*')
    expect(packageJson.build.files).not.toContain('scripts/**/*')

    const feishuTemplate = readFileSync(resolve(repositoryRoot, 'src/shared/feishu-template.ts'), 'utf8')
    expect(feishuTemplate).toContain("FEISHU_TEMPLATE_APP_TOKEN = 'UhZ6bYe6aafexms9WGXcomHInic'")
    expect(feishuTemplate).toContain('https://my.feishu.cn/base/${FEISHU_TEMPLATE_APP_TOKEN}')
  })

  it('contains no restrictive-use marker in tracked text files', () => {
    const scan = spawnSync('git.exe', ['grep', '-I', '-l', '-F', restrictiveUseTerm, '--', '.'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    })

    if (scan.error) throw scan.error
    if ((scan.status ?? 2) > 1) throw new Error(`RESTRICTIVE_USE_SCAN_FAILED:${scan.status}`)
    expect(scan.stdout.trim()).toBe('')
  })
})
