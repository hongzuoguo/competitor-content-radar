import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('generated Scrapling packaging contract', () => {
  it('ships the generated sidecar archive, manifest, and provenance', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
    const serialized = JSON.stringify(packageJson)

    expect(packageJson.scripts['build:scrapling']).toBe('node scripts/build-scrapling-engine.mjs')
    expect(serialized).toContain('.build-resources/scrapling-engine/engine-provenance.json')
    expect(serialized).not.toContain('scrapling-engine-manifest.json')
  })
})
