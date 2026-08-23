import { describe, expect, it } from 'vitest'
import {
  assignmentsFromCluster,
  createTopicClassificationSignature,
  fallbackTopicAssignments,
  type PersistedTopicAssignments,
  type TopicEvidenceWork
} from '../../src/services/feishu/topic-consolidation'

describe('Feishu topic consolidation', () => {
  it('creates a stable signature from classifier inputs and version only', () => {
    const works = [
      {
        ...work('b', 'AI工具教程'),
        title: '用 AI 搭建知识库',
        topicAngle: '企业知识库',
        viralPoints: ['开头反差'],
        metrics: { likes: 99_999 }
      },
      work('a', 'AI创业')
    ]

    const signature = createTopicClassificationSignature({ version: 'v1', works })

    expect(createTopicClassificationSignature({ version: 'v1', works: [...works].reverse() })).toBe(signature)
    expect(createTopicClassificationSignature({ version: 'v2', works })).not.toBe(signature)
    expect(createTopicClassificationSignature({
      version: 'v1',
      works: [{ ...works[0], metrics: { likes: 1 } }, works[1]]
    })).toBe(signature)
    expect(createTopicClassificationSignature({
      version: 'v1',
      works: [{ ...works[0], viralPoints: ['不同断点'] }, works[1]]
    })).not.toBe(signature)
  })

  it('retains compatible previous names and merges similar fine categories', () => {
    const works = [
      work('startup-1', 'AI创业'),
      work('startup-2', 'AI创业获客'),
      work('startup-3', 'AI创业培训'),
      work('tool-1', 'AI工具教程'),
      work('tool-2', 'AI工具设置')
    ]
    const previous: PersistedTopicAssignments = {
      assignments: { 'startup-1': 'AI创业与获客' },
      categories: ['AI创业与获客']
    }

    const result = fallbackTopicAssignments(works, previous)

    expect(result.assignments.get('startup-1')).toBe('AI创业与获客')
    expect(result.assignments.get('startup-2')).toBe('AI创业与获客')
    expect(result.assignments.get('startup-3')).toBe('AI创业与获客')
    expect(result.assignments.get('tool-1')).toBe(result.assignments.get('tool-2'))
  })

  it('caps fragmented fallback output at seven directions plus other', () => {
    const works = Array.from({ length: 12 }, (_, index) => (
      work(`work-${index}`, `独立方向${String.fromCharCode(65 + index)}`)
    ))

    const result = fallbackTopicAssignments(works)
    const categories = new Set(result.assignments.values())

    expect(categories.size).toBeLessThanOrEqual(8)
    expect(categories.has('其他方向')).toBe(true)
    expect([...result.assignments.keys()]).toHaveLength(works.length)
  })

  it('accepts a complete engine assignment with at most eight categories', () => {
    const works = [work('a', 'AI创业'), work('b', 'AI工具教程')]

    const result = assignmentsFromCluster(works, {
      categories: [
        { name: 'AI创业与获客', workIds: ['a'] },
        { name: 'AI工具与效率', workIds: ['b'] }
      ]
    })

    expect(Object.fromEntries(result.assignments)).toEqual({
      a: 'AI创业与获客',
      b: 'AI工具与效率'
    })
  })

  it('rejects engine assignments that omit or duplicate works', () => {
    const works = [work('a', 'AI创业'), work('b', 'AI工具教程')]

    expect(() => assignmentsFromCluster(works, {
      categories: [{ name: 'AI创业与获客', workIds: ['a', 'a'] }]
    })).toThrow('AI_TOPIC_ASSIGNMENT_INVALID')
  })
})

function work(id: string, category: string): TopicEvidenceWork {
  return {
    id,
    title: `${category}作品`,
    category,
    keywords: [category],
    topicAngle: category,
    viralPoints: []
  }
}
