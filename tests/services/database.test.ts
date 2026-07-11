import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'

describe('SQLite repositories', () => {
  let database: AppDatabase
  let repositories: AppRepositories

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    repositories = new AppRepositories(database.connection)
  })

  afterEach(() => database.close())

  it('applies the first schema exactly once', () => {
    expect(database.schemaVersion).toBe(1)
    database.migrate()
    expect(database.schemaVersion).toBe(1)
  })

  it('stores creators and prevents duplicate profile URLs', () => {
    const creator = repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })

    expect(repositories.creators.list()).toEqual([creator])
    expect(() => repositories.creators.create({ ...creator, id: 'creator-2' })).toThrow()
  })

  it('upserts a work without duplicating its platform ID', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })

    const first = repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '初始标题',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })
    const updated = repositories.works.upsert({ ...first, title: '更新标题' })

    expect(updated.id).toBe('work-1')
    expect(repositories.works.listByCreator('creator-1')).toHaveLength(1)
    expect(repositories.works.listByCreator('creator-1')[0].title).toBe('更新标题')
  })

  it('persists the latest successful workflow stage and settings', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '测试作品',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })
    repositories.jobs.saveStage('work-1', 'transcribed')
    repositories.settings.set('highlight.minimumBaselineWorks', 5)

    expect(repositories.jobs.getStage('work-1')).toBe('transcribed')
    expect(repositories.settings.get('highlight.minimumBaselineWorks')).toBe(5)
  })

  it('stores metric snapshots, analyses and run summaries', () => {
    repositories.creators.create({
      id: 'creator-1',
      platform: 'douyin',
      name: '样例博主',
      profileUrl: 'https://www.douyin.com/user/example',
      enabled: true,
      createdAt: '2026-07-11T09:00:00.000Z'
    })
    repositories.works.upsert({
      id: 'work-1',
      creatorId: 'creator-1',
      platformWorkId: '7658',
      title: '测试作品',
      publishedAt: '2026-07-11T08:00:00.000Z',
      originalUrl: 'https://www.douyin.com/video/7658',
      metrics: { likes: 10, comments: 2, shares: 1, collects: 3 }
    })

    repositories.snapshots.create({
      id: 'snapshot-1',
      workId: 'work-1',
      capturedAt: '2026-07-11T09:00:00.000Z',
      metrics: { likes: 20, comments: 3, shares: 2, collects: 4 }
    })
    repositories.analyses.save({
      workId: 'work-1',
      transcript: '完整文案',
      result: { referenceValueScore: 85 },
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptVersion: 'v1',
      tokenUsage: { input: 100, output: 50 },
      createdAt: '2026-07-11T09:05:00.000Z'
    })
    repositories.runs.save({
      id: 'run-1',
      kind: 'daily',
      status: 'completed',
      startedAt: '2026-07-11T09:00:00.000Z',
      finishedAt: '2026-07-11T09:10:00.000Z',
      summary: { discovered: 1, analyzed: 1 }
    })

    expect(repositories.snapshots.listByWork('work-1')).toHaveLength(1)
    expect(repositories.analyses.get('work-1')?.provider).toBe('deepseek')
    expect(repositories.runs.get('run-1')?.summary).toEqual({ discovered: 1, analyzed: 1 })
  })
})
