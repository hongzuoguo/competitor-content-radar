import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTaskPrompt } from '../../src/services/agent/agent-cli-runner'
import { RuntimeAgentFacade } from '../../src/services/agent/runtime-agent-facade'
import type { DesktopRuntime } from '../../src/main/runtime'

describe('local Agent analysis.write (seven-field schema)', () => {
  it('instructs the Agent to produce all seven fields including reusable patterns', () => {
    const prompt = buildTaskPrompt(
      { workId: 'douyin:1', model: 'deepseek-v4-flash' },
      { port: 39999, token: 'tok' }
    )

    expect(prompt).toContain('结构化拆解')
    expect(prompt).toContain('可复用模式(reusablePatterns 数组)')
    expect(prompt).toContain('差异化建议(differentiatedSuggestions 对象,含 angles/titles/openings/risks 四个数组)')
    expect(prompt).toContain('"reusablePatterns":[...]')
    expect(prompt).toContain('"category":"<具体创作方向>"')
    expect(prompt).toContain('"keywords":["<完整主题词组>",')
    expect(prompt).toContain('"differentiatedSuggestions":{"angles":[...],"titles":[...],"openings":[...],"risks":[...]}')
  })

  it('persists reusablePatterns and differentiatedSuggestions when the Agent provides them', async () => {
    let saved: unknown = null
    const runtime = {
      getWork: vi.fn().mockResolvedValue({ workId: 'douyin:1', transcript: '文字稿', metrics: { likes: 10, comments: 0, shares: 0, collects: 0 } }),
      getStoredAnalysis: vi.fn().mockResolvedValue(null),
      saveAgentAnalysis: vi.fn((record: unknown) => { saved = record })
    } as unknown as DesktopRuntime
    const facade = new RuntimeAgentFacade(runtime, { list: () => [], getActiveRuntimeProfile: () => null } as never)

    await facade.writeAnalysis({
      workId: 'douyin:1',
      category: 'AI工具测评',
      keywords: ['工具对比', '实测体验', '避坑建议'],
      angle: '角度',
      hook: '钩子',
      structure: ['结构一'],
      explosion: ['爆点一'],
      highlights: ['亮点一'],
      reusablePatterns: ['模式一', '模式二'],
      differentiatedSuggestions: { angles: ['角度建议'], titles: ['标题建议'], openings: ['开头建议'], risks: ['风险提示'] },
      modelId: 'deepseek-v4-flash',
      schemaVersion: 'v1'
    })

    expect(saved).toMatchObject({
      result: {
        topicCategory: 'AI工具测评',
        contentKeywords: ['工具对比', '实测体验', '避坑建议'],
        topicAngle: '角度',
        reusablePatterns: ['模式一', '模式二'],
        differentiatedSuggestions: { angles: ['角度建议'], titles: ['标题建议'], openings: ['开头建议'], risks: ['风险提示'] }
      }
    })
  })

  it('fills empty arrays when the Agent omits the two optional fields', async () => {
    let saved: unknown = null
    const runtime = {
      getWork: vi.fn().mockResolvedValue({ workId: 'douyin:2', transcript: '文字稿', metrics: { likes: 1, comments: 0, shares: 0, collects: 0 } }),
      getStoredAnalysis: vi.fn().mockResolvedValue(null),
      saveAgentAnalysis: vi.fn((record: unknown) => { saved = record })
    } as unknown as DesktopRuntime
    const facade = new RuntimeAgentFacade(runtime, { list: () => [], getActiveRuntimeProfile: () => null } as never)

    await facade.writeAnalysis({
      workId: 'douyin:2',
      category: '内容创作方法',
      keywords: ['选题系统', '内容策略'],
      angle: '角度',
      hook: '钩子',
      structure: ['结构一'],
      explosion: [],
      highlights: [],
      modelId: 'deepseek-v4-flash',
      schemaVersion: 'v1'
    })

    expect(saved).toMatchObject({
      result: {
        reusablePatterns: [],
        differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
      }
    })
  })
})
