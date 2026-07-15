import { describe, expect, it } from 'vitest'
import { parseScraplingEngineManifest } from '../../src/services/scrapling-engine/manifest'

const validManifest = {
  protocolVersion: 1,
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  url: 'https://github.com/hongzuoguo/competitor-content-radar/releases/download/scrapling-engine-v0.1.0/scrapling-engine-win32-x64.zip',
  sha256: 'a'.repeat(64),
  size: 80_000_000
}

describe('parseScraplingEngineManifest', () => {
  it('accepts the supported release manifest', () => {
    expect(parseScraplingEngineManifest(validManifest)).toEqual(validManifest)
  })

  it.each([
    [{ ...validManifest, protocolVersion: 2 }, 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'],
    [{ ...validManifest, url: 'http://github.com/engine.zip' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, url: 'https://example.com/engine.zip' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, sha256: 'not-a-hash' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, size: 0 }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, size: 600_000_000 }, 'SCRAPLING_ENGINE_MANIFEST_INVALID'],
    [{ ...validManifest, version: '../escape' }, 'SCRAPLING_ENGINE_MANIFEST_INVALID']
  ])('rejects an unsafe or incompatible manifest', (manifest, code) => {
    expect(() => parseScraplingEngineManifest(manifest)).toThrow(expect.objectContaining({ code }))
  })
})

