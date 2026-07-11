import { describe, expect, it } from 'vitest'
import { APP_METADATA } from '../../src/shared/app-metadata'

describe('application metadata', () => {
  it('uses the confirmed product identity and first database schema', () => {
    expect(APP_METADATA.productName).toBe('对标内容雷达')
    expect(APP_METADATA.schemaVersion).toBe(1)
  })
})
