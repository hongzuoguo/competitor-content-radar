import { describe, expect, it } from 'vitest'
import { parseScraplingEngineManifest } from '../../src/services/scrapling-engine/manifest'

const validManifest = {
  protocolVersion: 1,
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  archive: {
    filename: 'scrapling-engine-win32-x64.zip',
    size: 80_000_000,
    sha256: 'a'.repeat(64)
  },
  sourceCommit: 'b'.repeat(40),
  pythonLockSha256: 'c'.repeat(64)
}

describe('parseScraplingEngineManifest', () => {
  it('accepts the generated embedded manifest', () => {
    expect(parseScraplingEngineManifest(validManifest)).toEqual(validManifest)
  })

  it.each([
    [{ ...validManifest, protocolVersion: 2 }, 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'],
    [{ ...validManifest, archive: { ...validManifest.archive, filename: '../engine.zip' } }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, archive: { ...validManifest.archive, sha256: 'not-a-hash' } }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, archive: { ...validManifest.archive, size: 0 } }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, archive: { ...validManifest.archive, size: 600_000_000 } }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, version: '01.2.3' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, sourceCommit: 'not-a-commit' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, pythonLockSha256: 'not-a-hash' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, url: 'https://example.com/engine.zip' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID']
  ])('rejects an unsafe or incompatible manifest', (manifest, code) => {
    expect(() => parseScraplingEngineManifest(manifest)).toThrow(expect.objectContaining({ code }))
  })
})
