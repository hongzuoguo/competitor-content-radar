import { describe, expect, it } from 'vitest'
import {
  buildContentTermClusteringPrompt,
  parseAndValidateContentTerms,
  type ContentTermCandidateWork
} from '../../src/services/ai/content-term-clustering'

const works: ContentTermCandidateWork[] = [
  {
    id: 'work-1',
    title: '县城老板用AI搭建企业知识库',
    candidates: ['县城老板', '企业知识库', '企业知识库搭建']
  },
  {
    id: 'work-2',
    title: '企业知识库自动更新实测',
    candidates: ['企业知识库', '知识库自动更新']
  }
]

describe('content-term clustering', () => {
  it('tells the selected AI to validate nodejieba candidates instead of repeating broad topics', () => {
    const prompt = buildContentTermClusteringPrompt(works)

    expect(prompt).toContain('nodejieba')
    expect(prompt).toContain('合并同义词')
    expect(prompt).toContain('不得直接使用创作方向')
    expect(prompt).toContain('企业知识库搭建')
  })

  it('accepts useful concrete terms that can cover multiple works', () => {
    expect(parseAndValidateContentTerms(JSON.stringify({
      terms: [
        { name: '企业知识库搭建', workIds: ['work-1', 'work-2'] },
        { name: '县城老板获客', workIds: ['work-1'] }
      ]
    }), works)).toEqual({
      terms: [
        { name: '企业知识库搭建', workIds: ['work-1', 'work-2'] },
        { name: '县城老板获客', workIds: ['work-1'] }
      ]
    })
  })

  it('rejects unknown works when no valid term remains', () => {
    expect(() => parseAndValidateContentTerms(
      '{"terms":[{"name":"企业知识库","workIds":["missing"]}]}', works
    )).toThrow('AI_CONTENT_TERM_NO_VALID_TERMS')
  })

  it('keeps valid sibling terms, merges normalized duplicates and deduplicates work ids', () => {
    expect(parseAndValidateContentTerms(JSON.stringify({
      terms: [
        { name: '企业知识库搭建', workIds: ['work-1', 'work-1'] },
        { name: '这个词条明显超过允许的十六个字符长度限制', workIds: ['work-1'] },
        { name: ' 企业知识库搭建 ', workIds: ['work-2'] },
        { name: 'AI 获客', workIds: ['missing'] },
        { name: 42, workIds: ['work-1'] }
      ]
    }), works)).toEqual({
      terms: [{ name: '企业知识库搭建', workIds: ['work-1', 'work-2'] }]
    })
  })

  it('rejects a non-empty response when every proposed term is invalid', () => {
    expect(() => parseAndValidateContentTerms(JSON.stringify({
      terms: [
        { name: '这个词条明显超过允许的十六个字符长度限制', workIds: ['work-1'] },
        { name: 'AI 获客', workIds: ['missing'] }
      ]
    }), works)).toThrow('AI_CONTENT_TERM_NO_VALID_TERMS')
  })

  it('accepts an explicit empty term set', () => {
    expect(parseAndValidateContentTerms('{"terms":[]}', works)).toEqual({ terms: [] })
  })

  it('rejects malformed or structurally invalid top-level responses with a stable code', () => {
    for (const response of ['not json', '[]', '{"terms":{}}', '{"terms":[],"extra":true}']) {
      expect(() => parseAndValidateContentTerms(response, works))
        .toThrow('AI_CONTENT_TERM_RESPONSE_INVALID')
    }
  })

  it('limits the final valid merged result instead of rejecting the whole response', () => {
    const terms = Array.from({ length: 35 }, (_, index) => ({
      name: `有效词条${String(index + 1).padStart(2, '0')}`,
      workIds: ['work-1']
    }))

    expect(parseAndValidateContentTerms(JSON.stringify({ terms }), works).terms).toHaveLength(30)
  })
})
