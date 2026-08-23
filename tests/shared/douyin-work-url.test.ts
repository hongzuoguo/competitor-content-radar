import { describe, expect, it } from 'vitest'
import { extractDouyinWorkUrl } from '../../src/shared/douyin-work-url'

describe('extractDouyinWorkUrl', () => {
  it('extracts the supplied short work URL from a complete share message', () => {
    const input = '5.82 10/10 :3pm O@K.Jv dNW:/ 王自如聊AI在制造业的运用 ... https://v.douyin.com/XBND3GOR4Fo/ 复制此链接，打开Dou音搜索，直接观看视频！'

    expect(extractDouyinWorkUrl(input)).toBe('https://v.douyin.com/XBND3GOR4Fo/')
  })

  it.each([
    ['direct video', '分享：https://www.douyin.com/video/7658288075461725474。', 'https://www.douyin.com/video/7658288075461725474'],
    ['creator modal', 'https://www.douyin.com/user/MS4wLjABAAAA?from_tab_name=main&modal_id=7659607768617307402', 'https://www.douyin.com/user/MS4wLjABAAAA?from_tab_name=main&modal_id=7659607768617307402'],
    ['jingxuan modal', 'https://www.douyin.com/jingxuan?modal_id=7659607768617307402', 'https://www.douyin.com/jingxuan?modal_id=7659607768617307402'],
    ['search modal', 'https://www.douyin.com/search/AI?modal_id=7659607768617307402', 'https://www.douyin.com/search/AI?modal_id=7659607768617307402']
  ])('extracts a valid %s URL', (_name, input, expected) => {
    expect(extractDouyinWorkUrl(input)).toBe(expected)
  })

  it('removes common trailing Chinese and English punctuation', () => {
    expect(extractDouyinWorkUrl('观看 (https://v.douyin.com/AbC12/)， 下一条')).toBe('https://v.douyin.com/AbC12/')
    expect(extractDouyinWorkUrl('Watch https://www.douyin.com/video/7658?!')).toBe('https://www.douyin.com/video/7658')
  })

  it('stops a URL at Chinese punctuation when text continues without whitespace', () => {
    expect(extractDouyinWorkUrl('观看：https://v.douyin.com/AbC12/。复制此链接')).toBe('https://v.douyin.com/AbC12/')
    expect(extractDouyinWorkUrl('https://v.douyin.com/AbC12/：复制此链接')).toBe('https://v.douyin.com/AbC12/')
  })

  it('stops a trailing-slash short URL at ASCII punctuation before adjacent share text', () => {
    expect(extractDouyinWorkUrl('Watch https://v.douyin.com/First1/,copy this link')).toBe('https://v.douyin.com/First1/')
  })

  it('stops a no-slash short URL at ASCII punctuation before adjacent share text', () => {
    expect(extractDouyinWorkUrl('https://v.douyin.com/First1,copy')).toBe('https://v.douyin.com/First1')
  })

  it('recognizes an uppercase HTTP scheme', () => {
    expect(extractDouyinWorkUrl('HTTPS://v.douyin.com/AbC12/')).toBe('https://v.douyin.com/AbC12/')
  })

  it('rejects overlong share text while accepting input at the length limit', () => {
    const url = 'https://v.douyin.com/AbC12/'

    expect(extractDouyinWorkUrl(`${'x'.repeat(20_001)} ${url}`)).toBeNull()
    expect(extractDouyinWorkUrl(`${'x'.repeat(20_000 - url.length)}${url}`)).toBe(url)
  })

  it.each([
    'https://v.douyin.com/AbC12/?x=a;b',
    'https://v.douyin.com/AbC12/?x=a,b'
  ])('preserves ASCII punctuation inside a query: %s', (input) => {
    expect(extractDouyinWorkUrl(input)).toBe(input)
  })

  it('continues scanning after an invalid URL followed immediately by a Chinese comma', () => {
    expect(extractDouyinWorkUrl('https://example.com/a，https://v.douyin.com/First1/')).toBe('https://v.douyin.com/First1/')
  })

  it('continues scanning at a nested scheme after an invalid URL and ASCII comma', () => {
    expect(extractDouyinWorkUrl('https://example.com/a,https://v.douyin.com/First1/')).toBe('https://v.douyin.com/First1/')
  })

  it('uses the first valid work URL and skips earlier invalid links', () => {
    const input = 'https://example.com/a https://www.douyin.com/user/test https://v.douyin.com/First1/ https://www.douyin.com/video/7658'

    expect(extractDouyinWorkUrl(input)).toBe('https://v.douyin.com/First1/')
  })

  it.each([
    '',
    '没有链接',
    'https://www.douyin.com/user/test',
    'https://www.douyin.com/jingxuan',
    'https://www.douyin.com/search/AI',
    'http://v.douyin.com/Unsafe/',
    'https://example.com/video/7658',
    'https://www.douyin.com:444/video/7658',
    'https://name:secret@www.douyin.com/video/7658',
    'https://www.douyin.com/search/AI?modal_id=abc',
    'https://www.douyin.com/jingxuan?modal_id=123&modal_id=456'
  ])('returns null for unsupported or unsafe input: %s', (input) => {
    expect(extractDouyinWorkUrl(input)).toBeNull()
  })
})
