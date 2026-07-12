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

  it('continues after a matching aweme stub without a download URL', () => {
    const work = extractWorkFromPayload('7658', {
      first: { aweme_id: '7658', desc: 'stub' },
      second: { aweme_id: '7658', desc: 'valid', video: { play_addr: { url_list: ['https://media.test/valid'] } } }
    })

    expect(work).toMatchObject({ platformWorkId: '7658', title: 'valid', downloadUrl: 'https://media.test/valid' })
  })

  it.each([
    { play_addr: { url_list: [] } },
    { url_list: ['https://media.test/unsupported'] }
  ])('continues after a generic-id candidate with an unusable video address %#', (video) => {
    const work = extractWorkFromPayload('7658', {
      first: { id: '7658', desc: 'not a usable work', video },
      second: { awemeId: '7658', desc: 'valid', video: { downloadAddress: { url_list: ['http://media.test/valid'] } } }
    })

    expect(work).toMatchObject({ title: 'valid', downloadUrl: 'http://media.test/valid' })
  })
})
