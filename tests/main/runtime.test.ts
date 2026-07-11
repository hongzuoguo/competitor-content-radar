import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { DesktopRuntime } from '../../src/main/runtime'
import type { Work } from '../../src/core/domain'

describe('desktop runtime assembly', () => {
  let database: AppDatabase

  beforeEach(() => { database = new AppDatabase(':memory:') })
  afterEach(() => database.close())

  it('persists creators, normalizes URLs and enforces the ten-creator limit', async () => {
    const runtime = new DesktopRuntime(database, { discover: vi.fn(), processWork: vi.fn(), login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/first?from_tab_name=main')
    expect((await runtime.listCreators())[0].profileUrl).toBe('https://www.douyin.com/user/first')

    for (let index = 1; index < 10; index += 1) {
      await runtime.addCreator(`https://www.douyin.com/user/${index}`)
    }
    await expect(runtime.addCreator('https://www.douyin.com/user/overflow')).rejects.toThrow('CREATOR_LIMIT_REACHED')
  })

  it('discovers, stores and processes recent works when run now is accepted', async () => {
    const work: Work = {
      id: 'douyin:7658', creatorId: '', platformWorkId: '7658', title: '测试作品',
      publishedAt: new Date().toISOString(), originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: 'https://video.example/7658.mp4',
      metrics: { likes: 12000, comments: 100, shares: 20, collects: 30 }
    }
    const discover = vi.fn(async (creatorId: string) => [{ ...work, creatorId }])
    const processWork = vi.fn(async () => ({
      transcript: '完整文案', provider: 'qwen', model: 'qwen3.7-plus', promptVersion: 'v1',
      result: { referenceValueScore: 88, referenceValueReason: '可迁移' },
      tokenUsage: { input: 10, output: 10 }
    }))
    const runtime = new DesktopRuntime(database, { discover, processWork, login: vi.fn() })
    await runtime.addCreator('https://www.douyin.com/user/first')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'qwen3.7-plus' })

    expect(await runtime.runNow()).toEqual({ accepted: true })
    expect(processWork).toHaveBeenCalledTimes(1)
    const dashboard = await runtime.getDashboard()
    expect(dashboard.newWorks).toBe(1)
    expect(dashboard.analyzedWorks).toBe(1)
    expect(dashboard.highlights).toHaveLength(1)
  })

  it('reports business idleness around a running collection', async () => {
    let finishDiscovery!: (works: Work[]) => void
    const discovery = new Promise<Work[]>((resolve) => { finishDiscovery = resolve })
    const runtime = new DesktopRuntime(database, {
      discover: vi.fn(() => discovery), processWork: vi.fn(), login: vi.fn()
    })
    const becameIdle = vi.fn()
    runtime.onBusinessIdle(becameIdle)
    await runtime.addCreator('https://www.douyin.com/user/idle-check')
    await runtime.saveSettings({ providerId: 'qwen', modelId: 'qwen3.7-plus' })

    expect(runtime.isBusinessIdle()).toBe(true)
    const run = runtime.runNow()
    expect(runtime.isBusinessIdle()).toBe(false)
    finishDiscovery([])
    await run
    expect(runtime.isBusinessIdle()).toBe(true)
    expect(becameIdle).toHaveBeenCalledTimes(1)
  })
})
