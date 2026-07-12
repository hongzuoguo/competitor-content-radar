import { describe, expect, it } from 'vitest'
import { extractWorkFromPayload, extractWorksFromPayload } from '../../src/services/douyin/discovery'

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

  it('ignores a parent generic id and finds the nested aweme', () => {
    const work = extractWorkFromPayload('7658', {
      id: '7658',
      data: { aweme_detail: { aweme_id: '7658', desc: 'target', video: { play_addr: { url_list: ['https://media.test/7658'] } } } }
    })

    expect(work).toMatchObject({ platformWorkId: '7658', title: 'target', downloadUrl: 'https://media.test/7658' })
  })

  it('ignores a titled parent generic id and finds the nested video-shaped aweme', () => {
    const work = extractWorkFromPayload('7658', {
      id: '7658',
      title: 'page title',
      data: { aweme_detail: { aweme_id: '7658', desc: 'deep work', video: { play_addr: { url_list: ['https://media.test/deep'] } } } }
    })

    expect(work).toMatchObject({ title: 'deep work', downloadUrl: 'https://media.test/deep' })
  })

  it('continues after an invalid matching candidate', () => {
    const work = extractWorkFromPayload('7658', {
      first: { aweme_id: '7658', create_time: Symbol('invalid') },
      second: { aweme_id: '7658', desc: 'valid', video: { play_addr: { url_list: ['https://media.test/valid'] } } }
    })

    expect(work).toMatchObject({ platformWorkId: '7658', title: 'valid', downloadUrl: 'https://media.test/valid' })
  })
})
