import { describe, expect, it } from 'vitest'
import { extractTitlePhraseCandidates } from '../../src/services/feishu/title-phrase-extractor'

describe('title phrase candidate extraction', () => {
  it('uses nodejieba tokens to retain concrete people, tools and actions from a title', () => {
    const candidates = extractTitlePhraseCandidates('县城老板用AI搭建企业知识库')

    expect(candidates).toEqual(expect.arrayContaining([
      '县城老板',
      '企业知识库',
      '企业知识库搭建'
    ]))
    expect(candidates).not.toEqual(expect.arrayContaining(['县城', '老板', '企业', '搭建']))
  })

  it('removes counts, particles and generic single-character fragments', () => {
    const candidates = extractTitlePhraseCandidates('三个头部博主蒸馏成了AI创作班底')

    expect(candidates).toEqual(expect.arrayContaining(['头部博主', 'AI创作班底']))
    expect(candidates).not.toEqual(expect.arrayContaining(['三个', '成了', '了']))
  })
})
