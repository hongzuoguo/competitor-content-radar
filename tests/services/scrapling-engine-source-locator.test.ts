import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceEngineLocator } from '../../src/services/scrapling-engine/source-locator'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = join(tmpdir(), `scrapling-source-locator-${Date.now()}-${roots.length}`)
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('createSourceEngineLocator', () => {
  it('returns the fixed checkout Python command', async () => {
    const root = await createRoot()
    const engineDirectory = join(root, 'engine', 'scrapling')
    const python = join(engineDirectory, '.venv', 'Scripts', 'python.exe')
    const source = join(engineDirectory, 'scrapling_engine.py')
    await mkdir(join(engineDirectory, '.venv', 'Scripts'), { recursive: true })
    await writeFile(python, '')
    await writeFile(source, '')

    await expect(createSourceEngineLocator(root).ensureInstalled()).resolves.toEqual({
      file: python,
      args: ['-u', source],
      cwd: engineDirectory
    })
  })

  it('reports a missing checkout virtual environment with a stable error code', async () => {
    const root = await createRoot()
    const engineDirectory = join(root, 'engine', 'scrapling')
    await mkdir(engineDirectory, { recursive: true })
    await writeFile(join(engineDirectory, 'scrapling_engine.py'), '')

    await expect(createSourceEngineLocator(root).ensureInstalled()).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_PYTHON_UNAVAILABLE'
    })
  })

  it('reports a missing engine source with the same stable error code', async () => {
    const root = await createRoot()
    const python = join(root, 'engine', 'scrapling', '.venv', 'Scripts', 'python.exe')
    await mkdir(dirname(python), { recursive: true })
    await writeFile(python, '')

    await expect(createSourceEngineLocator(root).ensureInstalled()).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_PYTHON_UNAVAILABLE'
    })
  })
})
