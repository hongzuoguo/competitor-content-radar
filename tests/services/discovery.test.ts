import { describe, expect, it } from 'vitest'
import { extractWorksFromPayload } from '../../src/services/douyin/discovery'

describe('Douyin discovery payload extraction', () => {
  it('extracts works from common aweme list response shapes', () => {
    const payload = {
      data: {
        aweme_list: [{ aweme_id: '1', desc: '作品一' }, { aweme_id: '2', desc: '作品二' }]
      }
    }
    expect(extractWorksFromPayload('creator-1', payload).map((work) => work.platformWorkId)).toEqual([
      '1',
      '2'
    ])
  })

  it('ignores unrelated JSON responses', () => {
    expect(extractWorksFromPayload('creator-1', { status: 'ok' })).toEqual([])
  })
})
