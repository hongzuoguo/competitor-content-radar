import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { FeishuBaseMissingError } from '../../src/services/feishu/bitable'
import { FeishuIntegration, snapshotIdentity } from '../../src/services/feishu/integration'
import type { WeeklyTopicClusterResult, WeeklyTopicWork } from '../../src/services/ai/weekly-topic-clustering'
import type {
  ContentTermCandidateWork,
  ContentTermClusterResult
} from '../../src/services/ai/content-term-clustering'

describe('Feishu integration', () => {
  let database: AppDatabase
  let repositories: AppRepositories

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    repositories = new AppRepositories(database.connection)
    seedCreatorAndWork(repositories)
  })

  afterEach(() => database.close())

  it('connects a custom app, provisions the selected Base, and stores the connection without syncing', async () => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    const providerFactory = tokenProviderFactory()
    const integration = integrationWith({ repositories, credentials, api, providerFactory })

    const view = await integration.connectCustomApp({
      appId: ' cli_example ',
      appSecret: ' app-secret ',
      baseUrl: 'https://example.feishu.cn/base/base-1?table=works'
    })

    expect(view).toMatchObject({
      status: 'connected',
      baseUrl: 'https://example.feishu.cn/base/base-1?table=works',
      customAppConfigured: true,
      maskedAppId: 'cli_***mple'
    })
    expect(JSON.stringify(view)).not.toContain('app-secret')
    expect(credentials.get('feishu.customApp')).toBe(JSON.stringify({
      appId: 'cli_example',
      appSecret: 'app-secret'
    }))
    expect(providerFactory).toHaveBeenCalledWith({
      appId: 'cli_example',
      appSecret: 'app-secret'
    })
    expect(api.resolveWikiNode).not.toHaveBeenCalled()
    expect(api.listTables).toHaveBeenCalledWith('base-1')
    expect(repositories.feishu.getBinding()).toMatchObject({ appToken: 'base-1', status: 'connected' })
    expect(api.fieldsFor('creators')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '博主ID' })
    ]))
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
    expect(api.remoteRecordCount()).toBe(0)
  })

  it('resolves a Wiki Bitable after tenant authentication and provisions its object token', async () => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    api.resolveWikiNode.mockResolvedValue({ objType: 'bitable', objToken: 'bascnResolved' })
    const providerFactory = tokenProviderFactory()
    const integration = integrationWith({ repositories, credentials, api, providerFactory })

    const view = await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/wiki/wikcn123?table=tbl1&view=vew1'
    })

    expect(providerFactory).toHaveBeenCalledTimes(1)
    expect(api.resolveWikiNode).toHaveBeenCalledWith('wikcn123')
    expect(api.listTables).toHaveBeenCalledWith('bascnResolved')
    expect(repositories.feishu.getBinding()).toMatchObject({ appToken: 'bascnResolved', status: 'connected' })
    expect(view.baseUrl).toBe('https://example.feishu.cn/base/bascnResolved?table=tbl1&view=vew1')
    expect(api.remoteRecordCount()).toBe(0)
  })

  it('rejects Wiki nodes that do not refer to a Bitable without persisting a connection', async () => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    api.resolveWikiNode.mockResolvedValue({ objType: 'docx', objToken: 'doccn123' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/wiki/wikcn123'
    })).rejects.toThrow('FEISHU_WIKI_NOT_BITABLE')

    expect(api.listTables).not.toHaveBeenCalled()
    expect(api.createTable).not.toHaveBeenCalled()
    expect(api.remoteRecordCount()).toBe(0)
    expect(credentials.get('feishu.customApp')).toBeNull()
    expect(repositories.feishu.getBinding()).toBeNull()
  })

  it.each([
    ['FEISHU_API_1254302:wiki.node Bearer fake-secret', 'FEISHU_API_1254302'],
    ['FEISHU_HTTP_403:GET wiki.node Bearer fake-secret', 'FEISHU_HTTP_403'],
    ['FEISHU_INVALID_RESPONSE:wiki.node Bearer fake-secret', 'FEISHU_INVALID_RESPONSE'],
    ['UNTRUSTED:wiki.node Bearer fake-secret', 'FEISHU_WIKI_NODE_INVALID_RESPONSE']
  ])('retains only stable code %s when resolving a Wiki node fails', async (source, expected) => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    api.resolveWikiNode.mockRejectedValue(new Error(source))
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    const error = await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/wiki/wikcn123'
    }).catch((caught) => caught as Error)

    expect(error.message).toBe(expected)
    expect(error.message).not.toContain('Bearer')
    expect(error.message).not.toContain('fake-secret')

    expect(api.listTables).not.toHaveBeenCalled()
    expect(api.remoteRecordCount()).toBe(0)
    expect(credentials.get('feishu.customApp')).toBeNull()
    expect(repositories.feishu.getBinding()).toBeNull()
  })

  it('rejects a Wiki node whose object token cannot safely identify a Bitable', async () => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    api.resolveWikiNode.mockResolvedValue({ objType: 'bitable', objToken: 'bascnResolved?table=tblInjected' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/wiki/wikcn123'
    })).rejects.toThrow('FEISHU_WIKI_NODE_INVALID_RESPONSE')

    expect(api.listTables).not.toHaveBeenCalled()
    expect(credentials.get('feishu.customApp')).toBeNull()
    expect(repositories.feishu.getBinding()).toBeNull()
  })

  it('drops invalid Wiki query values while retaining valid table and view identifiers', async () => {
    const api = feishuApi()
    api.resolveWikiNode.mockResolvedValue({ objType: 'bitable', objToken: 'bascnResolved' })
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    const view = await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/wiki/wikcn123?table=tbl1&view=not%20valid&token=bascnInjected'
    })

    expect(view.baseUrl).toBe('https://example.feishu.cn/base/bascnResolved?table=tbl1')
    expect(api.listTables).toHaveBeenCalledWith('bascnResolved')
  })

  it('syncs only the latest metric snapshot for each work and calendar day', async () => {
    repositories.snapshots.create({
      id: 'second-snapshot', workId: 'work-1',
      capturedAt: '2026-07-25T08:00:00.000Z',
      metrics: { likes: 25_000, comments: 30, shares: 12, collects: 8 }
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('snapshots')).toHaveLength(1)
    expect(api.recordsFor('snapshots')[0].fields).toMatchObject({
      快照ID: 'work-1:2026-07-25',
      点赞量: 25_000,
      评论量: 30
    })
  })

  it('refreshes managed growth and creative-direction rows while preserving manual rows', async () => {
    repositories.snapshots.create({
      id: 'work-1:2026-07-20', workId: 'work-1', capturedAt: '2026-07-20T00:00:00.000Z',
      metrics: { likes: 10_000, comments: 10, shares: 5, collects: 2 }
    })
    repositories.snapshots.create({
      id: 'work-1:2026-07-24', workId: 'work-1', capturedAt: '2026-07-24T00:00:00.000Z',
      metrics: { likes: 20_000, comments: 20, shares: 10, collects: 5 }
    })
    repositories.analyses.save({
      workId: 'work-1', transcript: 'AI 工具提升内容效率',
      result: { topicCategory: 'AI 工具', contentKeywords: ['自动化创作', '内容提效'], topicAngle: '用自动化降低内容成本' },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-24T00:00:00.000Z'
    })
    const api = feishuApi()
    api.listTables.mockResolvedValue([
      { tableId: 'creators', name: '博主' },
      { tableId: 'works', name: '作品分析' },
      { tableId: 'worksArchive', name: '归档作品' },
      { tableId: 'snapshots', name: '每日指标快照' },
      { tableId: 'growthTop10', name: '近7天增速TOP10' },
      { tableId: 'directions', name: '创作方向' },
      { tableId: 'contentTerms', name: '热门内容词' }
    ])
    api.addRemoteRecord('growthTop10', 'stale-growth', { 榜单ID: 'growth-top-9', 标题: '旧榜单' })
    api.addRemoteRecord('growthTop10', 'manual-growth', { 榜单ID: 'manual-row', 标题: '用户手填' })
    api.addRemoteRecord('directions', 'legacy-report', { 报告ID: 'weekly:2026-07-20', 主题趋势: '旧周报' })
    api.addRemoteRecord('directions', 'manual-direction', { 方向ID: 'manual-row', 创作方向: '用户方向' })
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('growthTop10')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: expect.objectContaining({ 榜单ID: 'growth-top-1', 排名: 1 }) }),
      expect.objectContaining({ recordId: 'manual-growth' })
    ]))
    expect(api.recordsFor('growthTop10')).toHaveLength(2)
    expect(api.recordsFor('directions')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: expect.objectContaining({ 方向ID: '方向：AI 工具', 创作方向: 'AI 工具' }) }),
      expect.objectContaining({ recordId: 'manual-direction' })
    ]))
    expect(api.recordsFor('directions')).toHaveLength(2)
  })

  it('uses one stable broad topic assignment for work rows and creative directions', async () => {
    repositories.works.upsert(workFixture(2))
    for (const [workId, topicCategory] of [
      ['work-1', 'AI创业'],
      ['work-2', 'AI创业获客']
    ] as const) {
      repositories.analyses.save({
        workId,
        transcript: `${topicCategory} 内容`,
        result: { topicCategory, contentKeywords: [topicCategory], topicAngle: topicCategory },
        provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
        createdAt: '2026-07-25T00:00:00.000Z'
      })
    }
    const clusterTopics = vi.fn().mockResolvedValue({
      categories: [{ name: 'AI创业与获客', workIds: ['work-1', 'work-2'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory(),
      clusterTopics
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(clusterTopics).toHaveBeenCalledWith(expect.any(Array), [])
    expect(api.recordsFor('works').map((record) => record.fields['选题分类']))
      .toEqual(['AI创业与获客', 'AI创业与获客'])
    expect(api.recordsFor('reports')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: expect.objectContaining({ 创作方向: 'AI创业与获客' }) })
    ]))

    repositories.works.upsert(workFixture(3))
    repositories.analyses.save({
      workId: 'work-3', transcript: 'AI创业培训内容',
      result: { topicCategory: 'AI创业培训', contentKeywords: ['创业课程'], topicAngle: '创业培训' },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    await integration.syncWork('work-3')

    expect(clusterTopics).toHaveBeenCalledTimes(1)
    expect(api.recordsFor('works').find((record) => record.fields['作品ID'] === 'work-3')?.fields['选题分类'])
      .toBe('AI创业与获客')
  })

  it('validates nodejieba title candidates with the selected engine and syncs word-cloud rows', async () => {
    repositories.works.upsert({
      ...workFixture(1),
      title: '县城老板用AI搭建企业知识库'
    })
    repositories.analyses.save({
      workId: 'work-1', transcript: '县城老板搭建企业知识库',
      result: { topicCategory: 'AI效率工具', contentKeywords: ['企业知识库', '本地获客'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const clusterContentTerms = vi.fn().mockResolvedValue({
      terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory(),
      clusterContentTerms
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(clusterContentTerms).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'work-1',
        title: '县城老板用AI搭建企业知识库',
        candidates: expect.arrayContaining(['企业知识库搭建'])
      })
    ])
    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({
          词条ID: 'term:企业知识库搭建',
          热门内容词: '企业知识库搭建',
          内容热度: 20_036
        })
      })
    ])

    await integration.syncAll()
    expect(clusterContentTerms).toHaveBeenCalledTimes(1)
  })

  it('preserves the last remote word cloud when semantic term validation fails', async () => {
    const clusterContentTerms = vi.fn().mockRejectedValue(new Error('AI_CONTENT_TERM_NO_VALID_TERMS'))
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory(),
      clusterContentTerms
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'old-term-record', {
      词条ID: 'term:企业知识库搭建',
      热门内容词: '企业知识库搭建'
    })
    repositories.feishu.saveRecordMapping({
      tableKey: 'contentTerms', localId: 'term:企业知识库搭建', recordId: 'old-term-record'
    })
    api.createRecord.mockClear()
    api.createRecords.mockClear()
    api.updateRecord.mockClear()
    api.updateRecords.mockClear()
    api.deleteRecord.mockClear()
    api.listRecords.mockClear()

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({
        recordId: 'old-term-record',
        fields: expect.objectContaining({ 热门内容词: '企业知识库搭建' })
      })
    ])
    expect(repositories.settings.get('feishu.contentTermClusters')).toBeNull()
    expect(repositories.feishu.getRecordMapping('contentTerms', 'term:企业知识库搭建'))
      .toBe('old-term-record')
    expect(api.createRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.createRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.deleteRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.listRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
  })

  it('does not touch the word cloud on incremental sync without a matching semantic cache', async () => {
    const clusterContentTerms = vi.fn().mockResolvedValue({
      terms: [{ name: '不应调用', workIds: ['work-1'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory(),
      clusterContentTerms
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'old-term-record', {
      词条ID: 'term:企业知识库搭建',
      热门内容词: '企业知识库搭建'
    })
    clusterContentTerms.mockClear()
    api.createRecord.mockClear()
    api.createRecords.mockClear()
    api.updateRecord.mockClear()
    api.updateRecords.mockClear()
    api.deleteRecord.mockClear()
    api.listRecords.mockClear()

    await integration.syncWork('work-1', false)

    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ recordId: 'old-term-record' })
    ])
    expect(clusterContentTerms).not.toHaveBeenCalled()
    expect(api.createRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.createRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.deleteRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.listRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
  })

  it('does not clear the word cloud when a non-semantic incremental sync has no current work', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-03-01T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const clusterContentTerms = vi.fn().mockResolvedValue({
      terms: [{ name: '不应调用', workIds: ['work-1'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'old-term-record', {
      词条ID: 'term:企业知识库搭建', 热门内容词: '企业知识库搭建'
    })
    api.createRecord.mockClear()
    api.createRecords.mockClear()
    api.updateRecord.mockClear()
    api.updateRecords.mockClear()
    api.deleteRecord.mockClear()
    api.listRecords.mockClear()

    await integration.syncWork('work-1', false)

    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ recordId: 'old-term-record' })
    ])
    expect(clusterContentTerms).not.toHaveBeenCalled()
    expect(api.createRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.createRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.deleteRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.listRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
  })

  it('preserves the word cloud when semantic clustering returns an explicit empty result', async () => {
    const clusterContentTerms = vi.fn().mockResolvedValue({ terms: [] })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'old-term-record', {
      词条ID: 'term:企业知识库搭建', 热门内容词: '企业知识库搭建'
    })
    api.createRecord.mockClear()
    api.createRecords.mockClear()
    api.updateRecord.mockClear()
    api.updateRecords.mockClear()
    api.deleteRecord.mockClear()
    api.listRecords.mockClear()

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ recordId: 'old-term-record' })
    ])
    expect(repositories.settings.get('feishu.contentTermClusters')).toBeNull()
    expect(api.createRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.createRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.deleteRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.listRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })
    expect(clusterContentTerms).toHaveBeenCalledTimes(2)
  })

  it('preserves the word cloud when no semantic engine or matching cache is available', async () => {
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory()
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'old-term-record', {
      词条ID: 'term:企业知识库搭建', 热门内容词: '企业知识库搭建'
    })
    api.createRecord.mockClear()
    api.createRecords.mockClear()
    api.updateRecord.mockClear()
    api.updateRecords.mockClear()
    api.deleteRecord.mockClear()
    api.listRecords.mockClear()

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ recordId: 'old-term-record' })
    ])
    expect(api.createRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.createRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.updateRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.deleteRecord.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
    expect(api.listRecords.mock.calls.some((call) => call[1] === 'contentTerms')).toBe(false)
  })

  it('retries semantic clustering instead of applying a legacy matching empty cache', async () => {
    const clusterContentTerms = vi.fn().mockResolvedValue({
      terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    const successful = repositories.settings.get<{
      signature: string
      result: ContentTermClusterResult
    }>('feishu.contentTermClusters')
    expect(successful).not.toBeNull()
    repositories.settings.set('feishu.contentTermClusters', {
      signature: successful!.signature,
      result: { terms: [] }
    })

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(clusterContentTerms).toHaveBeenCalledTimes(2)
    expect(repositories.settings.get('feishu.contentTermClusters')).toEqual(successful)
    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ 热门内容词: '企业知识库搭建' }) })
    ])
  })

  it('clears only managed word-cloud rows when a full semantic sync has no eligible works', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-03-01T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const clusterContentTerms = vi.fn()
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'managed-record', {
      词条ID: 'term:旧词条', 热门内容词: '旧词条'
    })
    api.addRemoteRecord('contentTerms', 'manual-record', {
      词条ID: 'manual:editor-choice', 热门内容词: '人工精选词'
    })

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(clusterContentTerms).not.toHaveBeenCalled()
    expect(api.recordsFor('contentTerms')).toEqual([
      expect.objectContaining({ recordId: 'manual-record' })
    ])
  })

  it('keeps cache persistence failures fatal instead of reporting an AI fallback success', async () => {
    const api = feishuApi()
    const clusterContentTerms = vi.fn().mockResolvedValue({
      terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }]
    })
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    const originalSet = repositories.settings.set.bind(repositories.settings)
    vi.spyOn(repositories.settings, 'set').mockImplementation((key, value) => {
      if (key === 'feishu.contentTermClusters') throw new Error('SETTINGS_WRITE_FAILED')
      originalSet(key, value)
    })

    await expect(integration.syncAll()).rejects.toThrow('SETTINGS_WRITE_FAILED')
  })

  it('replaces old managed word-cloud rows after a valid semantic result and preserves manual rows', async () => {
    const clusterContentTerms = vi.fn()
      .mockRejectedValueOnce(new Error('AI_TEMPORARY'))
      .mockResolvedValueOnce({ terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }] })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterContentTerms
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    api.addRemoteRecord('contentTerms', 'garbage-record', {
      词条ID: 'term:开始就让AI', 热门内容词: '开始就让AI'
    })
    api.addRemoteRecord('contentTerms', 'manual-record', {
      词条ID: 'manual:editor-choice', 热门内容词: '人工精选词'
    })

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })
    expect(api.recordsFor('contentTerms').some((record) => record.recordId === 'garbage-record')).toBe(true)
    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(api.recordsFor('contentTerms')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: expect.objectContaining({ 热门内容词: '企业知识库搭建' }) }),
      expect.objectContaining({ recordId: 'manual-record' })
    ]))
    expect(api.recordsFor('contentTerms').some((record) => record.recordId === 'garbage-record')).toBe(false)
    expect(repositories.settings.get('feishu.contentTermClusters')).toMatchObject({
      result: { terms: [{ name: '企业知识库搭建', workIds: ['work-1'] }] }
    })
  })

  it('fills the template display fields for creator, topic category and content keywords', async () => {
    repositories.works.upsert({
      ...workFixture(1),
      title: '用 AI 自动生成短视频 #AI视频 #内容生产'
    })
    repositories.analyses.save({
      workId: 'work-1',
      transcript: '用人工智能自动生成短视频，提高内容生产效率。',
      result: {
        topicCategory: 'AI视频',
        contentKeywords: ['视频生成', '内容生产', '制作提效'],
        topicAngle: '用自动化工具降低短视频制作门槛',
        openingHook: { quote: '一分钟做完视频', type: '结果前置', mechanism: '效率反差' },
        structure: ['痛点', '演示', '结果'],
        viralPoints: ['一分钟自动成片'],
        highlights: ['低门槛'],
        reusablePatterns: ['先展示结果'],
        differentiatedSuggestions: { angles: [], titles: [], openings: [], risks: [] }
      },
      provider: 'test',
      model: 'test-model',
      promptVersion: 'v1',
      tokenUsage: null,
      createdAt: '2026-07-25T02:00:00.000Z'
    })
    const api = feishuApi()
    api.listTables.mockResolvedValue([
      { tableId: 'creators', name: '博主' },
      { tableId: 'works', name: '作品分析' },
      { tableId: 'worksArchive', name: '归档作品' },
      { tableId: 'snapshots', name: '每日指标快照' },
      { tableId: 'reports', name: '报告' }
    ])
    api.addRemoteField('creators', { fieldId: 'profile-url', name: '主页地址', type: 'text' })
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('works')[0].fields).toMatchObject({
      博主名称: '对标账号',
      账号类型: '对标账号',
      选题分类: 'AI视频'
    })
    expect(api.recordsFor('works')[0].fields.钩子).toContain('原句：一分钟做完视频')
    expect(api.recordsFor('works')[0].fields.钩子).not.toContain('quote：')
    expect(api.recordsFor('works')[0].fields.差异化创作建议).toContain('角度建议：')
    expect(api.recordsFor('works')[0].fields.差异化创作建议).not.toContain('angles：')
    expect(api.recordsFor('works')[0].fields.内容关键词).toBe('视频生成、内容生产、制作提效')
    expect(api.recordsFor('creators')[0].fields.主页地址).toBe('https://www.douyin.com/user/example')
  })

  it('derives a non-empty topic category and keywords before AI analysis is available', async () => {
    repositories.works.upsert({
      ...workFixture(1),
      title: '财务人的 AI 生产力 #财务 #AI工具 #办公提效'
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('works')[0].fields.选题分类).toBe('财务')
    expect(api.recordsFor('works')[0].fields.内容关键词).toEqual(expect.stringContaining('AI工具'))
  })

  it('writes my account type to the Feishu creator table', async () => {
    database.connection.prepare('UPDATE creators SET ownership = ? WHERE id = ?').run('mine', 'creator-1')
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('creators')[0].fields.账号类型).toBe('我的账号')
  })

  it('updates an existing Feishu creator row after the account becomes mine', async () => {
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    expect(api.recordsFor('creators')[0].fields.账号类型).toBe('对标账号')

    database.connection.prepare('UPDATE creators SET ownership = ? WHERE id = ?').run('mine', 'creator-1')
    await integration.syncAll()

    expect(api.recordsFor('creators')).toHaveLength(1)
    expect(api.recordsFor('creators')[0].fields.账号类型).toBe('我的账号')
  })

  it('does not write weak sentence fragments into content keywords', async () => {
    repositories.works.upsert({
      ...workFixture(1),
      title: '别只追热点：国产智能体进入实用期 #AI智能体'
    })
    repositories.analyses.save({
      workId: 'work-1',
      transcript: '开场先说结论，再用三步完成测试。',
      result: {
        topicCategory: 'AI行业观察',
        topicAngle: '国产智能体的落地机会',
        viralPoints: ['别只讨论参数'],
        highlights: ['开场直接给结论']
      },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T02:00:00.000Z'
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    const keywords = String(api.recordsFor('works')[0].fields.内容关键词)
    expect(keywords).toContain('AI智能体')
    expect(keywords).not.toMatch(/别只|国产(?:、|$)|开场|结论|三步|测试/u)
  })

  it('does not replace an existing connection when candidate credentials fail validation', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_old', appSecret: 'old-secret' })
    })
    saveBinding(repositories, 'old-base')
    const api = feishuApi()
    const providerFactory = vi.fn((value: { appId: string }) => ({
      getAccessToken: vi.fn().mockImplementation(async () => {
        if (value.appId === 'cli_new') throw new Error('FEISHU_CUSTOM_APP_CREDENTIALS_INVALID')
        return 'old-token'
      })
    }))
    const integration = integrationWith({ repositories, credentials, api, providerFactory })

    await expect(integration.connectCustomApp({
      appId: 'cli_new',
      appSecret: 'new-secret',
      baseUrl: 'https://example.feishu.cn/base/new-base'
    })).rejects.toThrow('应用凭证无效，请在飞书开放平台重新复制')

    expect(credentials.get('feishu.customApp')).toBe(JSON.stringify({
      appId: 'cli_old',
      appSecret: 'old-secret'
    }))
    expect(repositories.feishu.getBinding()?.appToken).toBe('old-base')
  })

  it('purges legacy OAuth credentials and never treats them as a connection', () => {
    const credentials = memoryCredentials({
      'feishu.oauth': JSON.stringify({ accessToken: 'legacy-token' })
    })
    const integration = integrationWith({
      repositories,
      credentials,
      api: feishuApi(),
      providerFactory: tokenProviderFactory()
    })

    expect(credentials.get('feishu.oauth')).toBeNull()
    expect(integration.getConnection()).toMatchObject({
      status: 'disconnected',
      customAppConfigured: false,
      maskedAppId: null
    })
  })

  it('clears custom credentials, Base bindings and mappings on disconnect', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    repositories.feishu.saveRecordMapping({
      tableKey: 'works',
      localId: 'work-1',
      recordId: 'record-1'
    })
    const integration = integrationWith({
      repositories,
      credentials,
      api: feishuApi(),
      providerFactory: tokenProviderFactory()
    })

    await integration.disconnect()

    expect(credentials.get('feishu.customApp')).toBeNull()
    expect(repositories.feishu.getBinding()).toBeNull()
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
    expect(integration.getConnection().status).toBe('disconnected')
  })

  it('batch-syncs 100 works in dependency order and stays idempotent on rerun', async () => {
    for (let index = 2; index <= 100; index += 1) {
      repositories.works.upsert(workFixture(index))
    }
    const credentials = memoryCredentials()
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    const workCreate = api.createRecords.mock.calls.find((call) => call[1] === 'works')
    expect(workCreate?.[2]).toHaveLength(100)
    expect(api.createRecord).not.toHaveBeenCalled()
    const creatorRecordId = repositories.feishu.getRecordMapping('creators', 'creator-1')
    expect(workCreate?.[2][0].fields.博主).toEqual([creatorRecordId])
    expect(repositories.feishu.getRecordMapping('snapshots', 'work-1:2026-07-25')).toBeTruthy()

    const createdBeforeRetry = api.remoteRecordCount()
    await integration.syncAll()

    expect(api.remoteRecordCount()).toBe(createdBeforeRetry)
    expect(api.updateRecords).toHaveBeenCalled()
  })

  it('serializes incremental work syncs and keeps the single-record path', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    const api = feishuApi()
    let record = 0
    api.createRecord.mockImplementation(async (_appToken, tableId, fields) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const created = { recordId: `single-${++record}` }
      api.addRemoteRecord(tableId, created.recordId, fields)
      return created
    })
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await Promise.all([integration.syncWork('work-1'), integration.syncWork('work-1')])

    expect(api.createRecord.mock.calls.filter((call) => call[1] === 'works')).toHaveLength(1)
    expect(api.updateRecord.mock.calls.filter((call) => call[1] === 'works')).toHaveLength(1)
    expect(api.createRecords.mock.calls.filter((call) => call[1] === 'works')).toHaveLength(0)
  })

  it('does not upload historical works during the initial backfill', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-1')
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toEqual([])
    expect(api.recordsFor('snapshots')).toEqual([])
  })

  it('uses the configured publication range only for works that have never entered Feishu', async () => {
    database.connection.prepare('UPDATE works SET ownership = ?, published_at = ? WHERE id = ?')
      .run('mine', '2026-07-15T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toEqual([])
  })

  it('keeps a mapped work until its first-sync retention time expires regardless of publication date', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-03-01T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'existing-work',
      firstSyncedAt: '2026-07-15T00:00:00.000Z'
    })
    const api = feishuApi()
    api.addRemoteRecord('works', 'existing-work', { 作品ID: 'work-1' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncAll()

    expect(api.recordsFor('works')).toHaveLength(1)
    expect(api.recordsFor('worksArchive')).toEqual([])
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBe('existing-work')
  })

  it('archives a mapped work after its first-sync retention time expires even when it was published today', async () => {
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'existing-work',
      firstSyncedAt: '2026-06-24T23:59:59.000Z'
    })
    const api = feishuApi()
    api.addRemoteRecord('works', 'existing-work', { 作品ID: 'work-1' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncAll()

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toHaveLength(1)
  })

  it('starts retention at the first post-upgrade sync for a legacy mapping without a timestamp', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-03-01T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', {
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 30
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({ tableKey: 'works', localId: 'work-1', recordId: 'legacy-work' })
    const api = feishuApi()
    api.addRemoteRecord('works', 'legacy-work', { 作品ID: 'work-1' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncAll()

    expect(api.recordsFor('works')).toHaveLength(1)
    expect(api.recordsFor('worksArchive')).toEqual([])
    expect(repositories.feishu.getRecordMappingRecord('works', 'work-1')?.firstSyncedAt)
      .toBe('2026-07-25T00:00:00.000Z')
  })

  it('moves a previously synced work to the archive after it has been in Feishu for 30 days', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-1')
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'existing-work',
      firstSyncedAt: '2026-06-01T00:00:00.000Z'
    })
    const api = feishuApi()
    api.listTables.mockResolvedValue([
      { tableId: 'creators', name: '博主' },
      { tableId: 'works', name: '作品分析' },
      { tableId: 'worksArchive', name: '归档作品' },
      { tableId: 'snapshots', name: '每日指标快照' },
      { tableId: 'reports', name: '报告' }
    ])
    api.listFields.mockImplementation(async (_token: string, tableId: string) => (
      tableId === 'worksArchive'
        ? [{ fieldId: 'archive-url', name: '原视频', type: 'text' }]
        : []
    ))
    api.addRemoteRecord('works', 'existing-work', { 作品ID: 'work-1' })
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.syncAll()

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({
          作品ID: 'work-1',
          原视频: 'https://www.douyin.com/video/1'
        })
      })
    ])
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
    expect(repositories.feishu.getRecordMapping('worksArchive', 'work-1')).toBeTruthy()
  })

  it('applies saved highlight thresholds to full and incremental sync', async () => {
    repositories.settings.set('app.publicSettings', {
      absoluteLikes: 50_000,
      highCollects: 10_000,
      highComments: 10_000,
      highShares: 10_000,
      relativePerformanceSurgeMultiplier: 100,
      relativePerformanceMultiplier: 10
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.syncAll()
    await integration.syncWork('work-1')

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('snapshots')).toEqual([])
    expect(api.createRecord.mock.calls.filter((call) => call[1] === 'works')).toEqual([])
  })

  it('syncs a recent own work even when it misses every saved highlight threshold', async () => {
    database.connection.prepare('UPDATE works SET ownership = ? WHERE id = ?').run('mine', 'work-1')
    repositories.settings.set('app.publicSettings', {
      absoluteLikes: 50_000,
      highCollects: 10_000,
      highComments: 10_000,
      highShares: 10_000,
      relativePerformanceSurgeMultiplier: 100,
      relativePerformanceMultiplier: 10
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()

    expect(api.recordsFor('works')).toHaveLength(1)
    expect(api.recordsFor('works')[0].fields.账号类型).toBe('我的账号')
    expect(api.recordsFor('snapshots')).toHaveLength(1)
  })

  it('keeps a mapped work on the exact retention boundary and archives it after the boundary', async () => {
    database.connection.prepare('UPDATE works SET ownership = ? WHERE id = ?').run('mine', 'work-1')
    const api = feishuApi()
    const integration = integrationWith({
      repositories,
      credentials: memoryCredentials(),
      api,
      providerFactory: tokenProviderFactory()
    })

    repositories.settings.set('app.publicSettings', { feishuSyncRecentDays: 30, feishuRetentionDays: 30 })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    expect(api.recordsFor('works')).toHaveLength(1)

    database.connection.prepare('UPDATE feishu_record_mappings SET first_synced_at = ? WHERE table_key = ? AND local_id = ?')
      .run('2026-06-25T00:00:00.000Z', 'works', 'work-1')
    await integration.syncAll()
    expect(api.recordsFor('works')).toHaveLength(1)

    database.connection.prepare('UPDATE feishu_record_mappings SET first_synced_at = ? WHERE table_key = ? AND local_id = ?')
      .run('2026-06-24T23:59:59.000Z', 'works', 'work-1')
    await integration.syncAll()
    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toHaveLength(1)
  })

  it('does not sync an unmapped work with a future publication time', async () => {
    database.connection.prepare('UPDATE works SET ownership = ?, published_at = ? WHERE id = ?')
      .run('mine', '2026-07-26T00:00:00.000Z', 'work-1')
    repositories.settings.set('app.publicSettings', { feishuSyncRecentDays: 365, feishuRetentionDays: 30 })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    expect(api.recordsFor('works')).toEqual([])
    expect(api.recordsFor('worksArchive')).toEqual([])
  })

  it('keeps the works mapping when deleting an expired remote work fails for a non-missing reason', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-1')
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'existing-work',
      firstSyncedAt: '2026-06-01T00:00:00.000Z'
    })
    const api = feishuApi()
    api.addRemoteRecord('works', 'existing-work', { 作品ID: 'work-1' })
    api.deleteRecord.mockRejectedValue(new Error('FEISHU_API_5000000'))
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.syncAll()).rejects.toThrow('FEISHU_API_5000000')

    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBe('existing-work')
  })

  it('reconciles other mapped expired works when incrementally syncing a current target', async () => {
    repositories.works.upsert(workFixture(2))
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-2')
    repositories.snapshots.create({
      id: 'work-2:2026-07-25', workId: 'work-2', capturedAt: '2026-07-25T01:00:00.000Z',
      metrics: { likes: 1, comments: 1, shares: 1, collects: 1 }
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-2', recordId: 'stale-work',
      firstSyncedAt: '2026-06-01T00:00:00.000Z'
    })
    repositories.feishu.saveRecordMapping({ tableKey: 'snapshots', localId: 'work-2:2026-07-25', recordId: 'stale-snapshot' })
    const api = feishuApi()
    api.addRemoteRecord('works', 'stale-work', { 作品ID: 'work-2' })
    api.addRemoteRecord('snapshots', 'stale-snapshot', { 快照ID: 'work-2:2026-07-25' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncWork('work-1')

    expect(api.recordsFor('worksArchive')).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ 作品ID: 'work-2' }) })
    ])
    expect(repositories.feishu.getRecordMapping('works', 'work-2')).toBeNull()
    expect(repositories.feishu.getRecordMapping('snapshots', 'work-2:2026-07-25')).toBeNull()
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeTruthy()
  })

  it('archives an expired incremental target and clears a missing current-record mapping', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-1')
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({
      tableKey: 'works', localId: 'work-1', recordId: 'missing-work',
      firstSyncedAt: '2026-06-01T00:00:00.000Z'
    })
    const api = feishuApi()
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncWork('work-1')

    expect(api.recordsFor('worksArchive')).toHaveLength(1)
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
  })

  it('deletes an incremental target that is in-window but no longer viral without archiving it', async () => {
    repositories.settings.set('app.publicSettings', {
      absoluteLikes: 50_000, highCollects: 10_000, highComments: 10_000, highShares: 10_000,
      relativePerformanceSurgeMultiplier: 100, relativePerformanceMultiplier: 10
    })
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({ tableKey: 'works', localId: 'work-1', recordId: 'old-work' })
    repositories.feishu.saveRecordMapping({ tableKey: 'snapshots', localId: 'work-1:2026-07-25', recordId: 'old-snapshot' })
    const api = feishuApi()
    api.addRemoteRecord('works', 'old-work', { 作品ID: 'work-1' })
    api.addRemoteRecord('snapshots', 'old-snapshot', { 快照ID: 'work-1:2026-07-25' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncWork('work-1')

    expect(api.recordsFor('worksArchive')).toEqual([])
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
    expect(repositories.feishu.getRecordMapping('snapshots', 'work-1:2026-07-25')).toBeNull()
  })

  it('cleans a mapped snapshot for an expired work even when its works mapping is already missing', async () => {
    database.connection.prepare('UPDATE works SET published_at = ? WHERE id = ?')
      .run('2026-06-01T00:00:00.000Z', 'work-1')
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({ tableKey: 'snapshots', localId: 'work-1:2026-07-25', recordId: 'orphan-snapshot' })
    const api = feishuApi()
    api.addRemoteRecord('snapshots', 'orphan-snapshot', { 快照ID: 'work-1:2026-07-25' })
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncAll()

    expect(api.recordsFor('snapshots')).toEqual([])
    expect(repositories.feishu.getRecordMapping('snapshots', 'work-1:2026-07-25')).toBeNull()
  })

  it('builds one decision cache for a large incremental sync instead of querying each creator', async () => {
    for (let index = 2; index <= 100; index += 1) repositories.works.upsert(workFixture(index))
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    const listAll = vi.spyOn(repositories.works, 'listAll')
    const listByCreator = vi.spyOn(repositories.works, 'listByCreator')
    const integration = integrationWith({ repositories, credentials, api: feishuApi(), providerFactory: tokenProviderFactory() })

    await integration.syncWork('work-1')

    expect(listAll).toHaveBeenCalledTimes(1)
    expect(listByCreator).not.toHaveBeenCalled()
  })

  it('does not mix null-creator baselines with a real __no_creator__ creator ID', async () => {
    repositories.creators.create({
      id: '__no_creator__', platform: 'douyin', name: '同名博主',
      profileUrl: 'https://www.douyin.com/user/sentinel', enabled: true,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    database.connection.prepare('UPDATE works SET creator_id = ?, likes = ?, comments = ?, shares = ?, collects = ? WHERE id = ?')
      .run('__no_creator__', 1_000, 0, 0, 0, 'work-1')
    for (let index = 2; index <= 6; index += 1) {
      repositories.works.upsert({
        ...workFixture(index), creatorId: null, metrics: { likes: 1, comments: 0, shares: 0, collects: 0 }
      })
    }
    repositories.settings.set('app.publicSettings', {
      absoluteLikes: 50_000, highCollects: 10_000, highComments: 10_000, highShares: 10_000,
      relativePerformanceSurgeMultiplier: 100, relativePerformanceMultiplier: 3
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory()
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    expect(api.recordsFor('works')).toEqual([])
  })

  it('maps missing document permission to an actionable message', async () => {
    const credentials = memoryCredentials()
    const api = feishuApi()
    api.listTables.mockRejectedValue(new Error('FEISHU_API_1254302:Permission denied'))
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await expect(integration.connectCustomApp({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    })).rejects.toThrow('FEISHU_API_1254302')
    expect(credentials.get('feishu.customApp')).toBeNull()
  })

  it('persists only a safe Feishu error summary after a sync failure', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'saved-secret' })
    })
    saveBinding(repositories, 'base-1')
    const api = feishuApi()
    api.listTables.mockRejectedValue(new Error(
      'FEISHU_API_1254302: Bearer fake-access-token {"app_secret":"fake-app-secret","detail":"raw response body"}'
    ))
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.syncAll()).rejects.toThrow('FEISHU_API_1254302')

    const binding = repositories.feishu.getBinding()
    const connection = integration.getConnection()
    expect(binding).toMatchObject({ status: 'sync_error', errorMessage: '飞书拒绝了访问（FEISHU_PERMISSION_DENIED）' })
    expect(connection).toMatchObject({ status: 'sync_error', message: '飞书拒绝了访问（FEISHU_PERMISSION_DENIED）' })
    for (const value of [JSON.stringify(binding), JSON.stringify(connection)]) {
      expect(value).not.toContain('fake-access-token')
      expect(value).not.toContain('fake-app-secret')
      expect(value).not.toContain('raw response body')
    }
  })

  it('marks the connection for repair when an incremental sync finds a deleted Base', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'deleted-base')
    const api = feishuApi()
    api.listTables.mockRejectedValue(new Error('FEISHU_API_1254040:AppNotFound'))
    const integration = integrationWith({
      repositories,
      credentials,
      api,
      providerFactory: tokenProviderFactory()
    })

    await expect(integration.syncWork('work-1')).rejects.toThrow()
    expect(integration.getConnection()).toMatchObject({ status: 'needs_repair' })
  })

  it('keeps the deleted Base recreate guidance after storing a safe error message', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'deleted-base')
    const api = feishuApi()
    api.listTables.mockRejectedValue(new FeishuBaseMissingError())
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.syncAll()).rejects.toThrow()

    expect(integration.getConnection()).toMatchObject({
      status: 'needs_repair',
      message: '已连接的飞书多维表格不存在（FEISHU_BASE_MISSING）'
    })
  })

  it('removes only mapped remote rows after their local creator and work are deleted', async () => {
    repositories.snapshots.create({
      id: 'work-1:2026-07-25', workId: 'work-1', capturedAt: '2026-07-25T00:00:00.000Z',
      metrics: { likes: 20_000, comments: 20, shares: 10, collects: 5 }
    })
    const api = feishuApi()
    const integration = integrationWith({ repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory() })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    repositories.feishu.saveRecordMapping({ tableKey: 'worksArchive', localId: 'work-1', recordId: 'archive-work' })
    api.addRemoteRecord('worksArchive', 'archive-work', {})
    api.addRemoteRecord('works', 'manual-work', {})

    repositories.works.delete('work-1')
    repositories.creators.delete('creator-1')
    await integration.syncAll()

    expect(api.recordsFor('snapshots')).toEqual([])
    expect(api.recordsFor('worksArchive')).toEqual([])
    expect(api.recordsFor('creators')).toEqual([])
    expect(api.recordsFor('works')).toEqual([expect.objectContaining({ recordId: 'manual-work' })])
    expect(repositories.feishu.getRecordMapping('snapshots', 'work-1:2026-07-25')).toBeNull()
    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
    expect(repositories.feishu.getRecordMapping('worksArchive', 'work-1')).toBeNull()
    expect(repositories.feishu.getRecordMapping('creators', 'creator-1')).toBeNull()
  })

  it('reclassifies full-sync topics only when classification inputs or version change', async () => {
    repositories.works.upsert({
      ...workFixture(1), id: 'work-0', platformWorkId: '0', sourceKey: 'douyin:0',
      publishedAt: '2026-07-24T00:00:00.000Z'
    })
    repositories.works.upsert(workFixture(2))
    for (const workId of ['work-0', 'work-1', 'work-2']) {
      repositories.analyses.save({
        workId, transcript: `${workId} transcript`,
        result: {
          topicCategory: 'AI创业', contentKeywords: ['AI创业'], topicAngle: '创业获客', viralPoints: ['开头反差']
        },
        provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
        createdAt: '2026-07-25T00:00:00.000Z'
      })
    }
    const clusterTopics = vi.fn(async (works: WeeklyTopicWork[]) => ({
      categories: [{ name: 'AI创业与获客', workIds: works.map((work) => work.id) }]
    }))
    const clusterContentTerms = vi.fn(async (works: ContentTermCandidateWork[]) => ({
      terms: [{ name: '对标作品', workIds: works.map((work) => work.id) }]
    }))
    const api = feishuApi()
    const credentials = memoryCredentials()
    const integration = integrationWith({
      repositories, credentials, api, providerFactory: tokenProviderFactory(),
      clusterTopics, clusterContentTerms
    })

    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'work-0' }),
      expect.objectContaining({ id: 'work-1' }),
      expect.objectContaining({ id: 'work-2' })
    ], [])
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(1)
    expect(clusterContentTerms).toHaveBeenCalledTimes(1)

    repositories.works.upsert({
      ...workFixture(1), id: 'work-0', platformWorkId: '0', sourceKey: 'douyin:0',
      publishedAt: '2026-07-26T00:00:00.000Z'
    })
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(1)
    expect(new Set(api.recordsFor('works').map((record) => record.fields['选题分类'])).size).toBeLessThanOrEqual(8)

    repositories.works.upsert({ ...workFixture(1), metrics: { likes: 30_000, comments: 40, shares: 20, collects: 10 } })
    repositories.snapshots.create({
      id: 'work-1:2026-07-26', workId: 'work-1', capturedAt: '2026-07-26T00:00:00.000Z',
      metrics: { likes: 30_000, comments: 40, shares: 20, collects: 10 }
    })
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(1)
    expect(clusterContentTerms).toHaveBeenCalledTimes(1)

    repositories.works.upsert(workFixture(3))
    repositories.analyses.save({
      workId: 'work-3', transcript: 'work-3 transcript',
      result: { topicCategory: 'AI工具', contentKeywords: ['AI工具'], topicAngle: '自动化', viralPoints: ['反差'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(2)

    repositories.works.delete('work-3')
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(3)

    repositories.analyses.save({
      workId: 'work-1', transcript: 'work-1 transcript',
      result: { topicCategory: 'AI创业', contentKeywords: ['AI创业'], topicAngle: '私域获客', viralPoints: ['开头反差'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(4)

    const upgraded = integrationWith({
      repositories, credentials, api, providerFactory: tokenProviderFactory(),
      clusterTopics, classifierTopicVersion: 'v2'
    })
    await upgraded.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(5)
  })

  it('keeps the last successful topic cache and continues syncing with fallback assignments', async () => {
    repositories.analyses.save({
      workId: 'work-1', transcript: 'first transcript',
      result: { topicCategory: 'AI创业', contentKeywords: ['AI创业'], topicAngle: '创业获客', viralPoints: ['开头反差'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const clusterTopics = vi.fn()
      .mockResolvedValueOnce({ categories: [{ name: 'AI创业与获客', workIds: ['work-1'] }] })
      .mockRejectedValueOnce(new Error('AI_TOPIC_UNAVAILABLE'))
      .mockResolvedValueOnce({ categories: [{ name: 'AI创业与获客', workIds: ['work-1', 'work-2'] }] })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory(), clusterTopics
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    const successful = repositories.settings.get('feishu.topicAssignments')
    repositories.feishu.saveRecordMapping({ tableKey: 'works', localId: 'orphan-work', recordId: 'orphan-work' })
    api.addRemoteRecord('works', 'orphan-work', {})

    repositories.analyses.save({
      workId: 'work-1', transcript: 'changed transcript',
      result: { topicCategory: 'AI创业', contentKeywords: ['AI创业'], topicAngle: '私域获客', viralPoints: ['开头反差'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    repositories.works.upsert(workFixture(2))
    repositories.analyses.save({
      workId: 'work-2', transcript: 'new work transcript',
      result: { topicCategory: '本地新增分类', contentKeywords: ['新作品'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })
    expect(repositories.settings.get('feishu.topicAssignments')).toEqual(successful)
    expect(api.recordsFor('works').find((record) => record.fields['作品ID'] === 'work-1')?.fields['选题分类'])
      .toBe('AI创业与获客')
    expect(api.recordsFor('works').find((record) => record.fields['作品ID'] === 'work-2')?.fields['选题分类'])
      .toBe('本地新增分类')
    expect(api.deleteRecord).toHaveBeenCalled()
    expect(repositories.feishu.getRecordMapping('works', 'orphan-work')).toBeNull()

    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(3)
    expect(api.recordsFor('works').find((record) => record.fields['作品ID'] === 'work-2')?.fields['选题分类'])
      .toBe('AI创业与获客')
  })

  it('uses local topic categories when the first AI classification fails', async () => {
    repositories.analyses.save({
      workId: 'work-1', transcript: 'first transcript',
      result: { topicCategory: '本地选题分类', contentKeywords: ['企业知识库'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const clusterTopics = vi.fn().mockRejectedValue(new Error('AI_TOPIC_UNAVAILABLE'))
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterTopics
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })

    await expect(integration.syncAll()).resolves.toMatchObject({ status: 'connected' })

    expect(repositories.settings.get('feishu.topicAssignments')).toBeNull()
    expect(api.recordsFor('works').find((record) => record.fields['作品ID'] === 'work-1')?.fields['选题分类'])
      .toBe('本地选题分类')
  })

  it('keeps topic-cache persistence failures fatal instead of reporting an AI fallback success', async () => {
    repositories.analyses.save({
      workId: 'work-1', transcript: 'first transcript',
      result: { topicCategory: '本地选题分类', contentKeywords: ['企业知识库'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const clusterTopics = vi.fn().mockResolvedValue({
      categories: [{ name: 'AI归并分类', workIds: ['work-1'] }]
    })
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api,
      providerFactory: tokenProviderFactory(), clusterTopics
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    const originalSet = repositories.settings.set.bind(repositories.settings)
    vi.spyOn(repositories.settings, 'set').mockImplementation((key, value) => {
      if (key === 'feishu.topicAssignments') throw new Error('SETTINGS_WRITE_FAILED')
      originalSet(key, value)
    })

    await expect(integration.syncAll()).rejects.toThrow('SETTINGS_WRITE_FAILED')
  })

  it('records an empty topic classification so reintroduced works are classified again', async () => {
    repositories.analyses.save({
      workId: 'work-1', transcript: 'work transcript',
      result: { topicCategory: 'AI创业', contentKeywords: ['AI创业'], topicAngle: '创业获客', viralPoints: ['开头反差'] },
      provider: 'test', model: 'test', promptVersion: 'v1', tokenUsage: null,
      createdAt: '2026-07-25T00:00:00.000Z'
    })
    const clusterTopics = vi.fn(async (works: WeeklyTopicWork[]) => ({
      categories: [{ name: 'AI创业与获客', workIds: works.map((work) => work.id) }]
    }))
    const api = feishuApi()
    const integration = integrationWith({
      repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory(), clusterTopics
    })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    await integration.syncAll()
    repositories.works.delete('work-1')
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(1)
    expect(repositories.settings.get('feishu.topicAssignments')).toMatchObject({
      assignments: {}, categories: []
    })

    repositories.works.upsert(workFixture(1))
    await integration.syncAll()
    expect(clusterTopics).toHaveBeenCalledTimes(2)
  })

  it('clears an orphan mapping when its remote row is already missing', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({ tableKey: 'works', localId: 'work-1', recordId: 'missing-work' })
    repositories.works.delete('work-1')
    const api = feishuApi()
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await integration.syncAll()

    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBeNull()
  })

  it('retains an orphan mapping when remote deletion fails for a non-missing error', async () => {
    const credentials = memoryCredentials({
      'feishu.customApp': JSON.stringify({ appId: 'cli_example', appSecret: 'secret' })
    })
    saveBinding(repositories, 'base-1')
    saveTables(repositories)
    repositories.feishu.saveRecordMapping({ tableKey: 'works', localId: 'work-1', recordId: 'undeleted-work' })
    repositories.works.delete('work-1')
    const api = feishuApi()
    api.deleteRecord.mockRejectedValue(new Error('FEISHU_API_5000000'))
    const integration = integrationWith({ repositories, credentials, api, providerFactory: tokenProviderFactory() })

    await expect(integration.syncAll()).rejects.toThrow('FEISHU_API_5000000')

    expect(repositories.feishu.getRecordMapping('works', 'work-1')).toBe('undeleted-work')
  })

  it('waits for an active full data sync started explicitly after custom-app connect', async () => {
    const started = deferred()
    const release = deferred()
    const api = feishuApi()
    api.createRecords.mockImplementationOnce(async (_token, _table, records) => {
      started.resolve()
      await release.promise
      return records.map((_record, index) => ({ recordId: `paused-record-${index}` }))
    })
    const integration = integrationWith({ repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory() })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    const sync = integration.syncAll()
    await started.promise
    let waitSettled = false
    const wait = activeDataSync(integration).then(() => { waitSettled = true })

    await Promise.resolve()
    expect(waitSettled).toBe(false)
    release.resolve()
    await Promise.all([sync, wait])
  })

  it('propagates explicit full data sync failure to waiters after custom-app connect', async () => {
    const started = deferred()
    const release = deferred()
    const api = feishuApi()
    api.createRecords.mockImplementationOnce(async () => {
      started.resolve()
      await release.promise
      throw new Error('FEISHU_API_5000000')
    })
    const integration = integrationWith({ repositories, credentials: memoryCredentials(), api, providerFactory: tokenProviderFactory() })
    await integration.connectCustomApp({
      appId: 'cli_example', appSecret: 'app-secret', baseUrl: 'https://example.feishu.cn/base/base-1'
    })
    const sync = integration.syncAll()
    await started.promise
    const wait = activeDataSync(integration)
    release.resolve()

    await expect(wait).rejects.toThrow('FEISHU_API_5000000')
    await expect(sync).rejects.toThrow('FEISHU_API_5000000')
  })

  it('uses the China-local calendar date for snapshot identity', () => {
    expect(snapshotIdentity('work-1', '2026-07-24T16:30:00.000Z'))
      .toBe('work-1:2026-07-25')
  })
})

function integrationWith({
  repositories,
  credentials,
  api,
  providerFactory,
  clusterTopics,
  clusterContentTerms,
  classifierTopicVersion
}: {
  repositories: AppRepositories
  credentials: ReturnType<typeof memoryCredentials>
  api: ReturnType<typeof feishuApi>
  providerFactory: ReturnType<typeof tokenProviderFactory> | ReturnType<typeof vi.fn>
  clusterTopics?: (works: WeeklyTopicWork[], preferredCategoryNames: string[]) => Promise<WeeklyTopicClusterResult>
  clusterContentTerms?: (works: ContentTermCandidateWork[]) => Promise<ContentTermClusterResult>
  classifierTopicVersion?: string
}) {
  return new FeishuIntegration({
    repositories,
    credentials,
    tokenProviderFactory: providerFactory,
    clientFactory: () => api,
    clusterTopics,
    clusterContentTerms,
    classifierTopicVersion,
    openExternal: vi.fn(),
    now: () => new Date('2026-07-25T00:00:00.000Z')
  })
}

function memoryCredentials(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get: vi.fn((key: string) => values.get(key) ?? null),
    set: vi.fn((key: string, value: string) => { values.set(key, value) }),
    delete: vi.fn((key: string) => { values.delete(key) })
  }
}

function activeDataSync(integration: FeishuIntegration): Promise<void> {
  return (integration as unknown as { waitForActiveDataSync(): Promise<void> }).waitForActiveDataSync()
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function tokenProviderFactory() {
  return vi.fn(() => ({ getAccessToken: vi.fn().mockResolvedValue('tenant-token') }))
}

function feishuApi() {
  let nextRecord = 0
  const remote = new Map<string, Array<{ recordId: string; fields: Record<string, unknown> }>>()
  const remoteFields = new Map<string, Array<{ fieldId: string; name: string; type: string }>>()
  const tables = [
    { tableId: 'creators', name: '博主' },
    { tableId: 'works', name: '作品分析' },
    { tableId: 'snapshots', name: '每日指标快照' },
    { tableId: 'reports', name: '报告' }
  ]
  const recordsFor = (tableId: string) => {
    const current = remote.get(tableId) ?? []
    remote.set(tableId, current)
    return current
  }
  return {
    resolveWikiNode: vi.fn().mockResolvedValue({ objType: 'bitable', objToken: 'base-1' }),
    findBasesByName: vi.fn().mockResolvedValue([]),
    createBase: vi.fn().mockResolvedValue({
      appToken: 'base-1',
      url: 'https://example.feishu.cn/base/base-1'
    }),
    listTables: vi.fn(async () => tables.map((table) => ({ ...table }))),
    renameTable: vi.fn(async (_token: string, tableId: string, name: string) => {
      const table = tables.find((candidate) => candidate.tableId === tableId)
      if (table) table.name = name
    }),
    renameField: vi.fn(async (_token: string, tableId: string, fieldId: string, name: string, type: string) => {
      const field = (remoteFields.get(tableId) ?? []).find((candidate) => candidate.fieldId === fieldId)
      if (field) Object.assign(field, { name, type })
      return { fieldId, name, type }
    }),
    deleteField: vi.fn(async (_token: string, tableId: string, fieldId: string) => {
      remoteFields.set(
        tableId,
        (remoteFields.get(tableId) ?? []).filter((field) => field.fieldId !== fieldId)
      )
    }),
    createTable: vi.fn(async (_token: string, table: {
      key: string
      name: string
      fields: Array<{ key: string; name: string; type: string }>
    }) => {
      tables.push({ tableId: table.key, name: table.name })
      remoteFields.set(table.key, table.fields.map((field) => ({
        fieldId: `field-${field.key}`, name: field.name, type: field.type
      })))
      return { tableId: table.key }
    }),
    listFields: vi.fn(async (_token: string, tableId: string) => (
      (remoteFields.get(tableId) ?? []).map((field) => ({ ...field }))
    )),
    createField: vi.fn(async (
      _token: string,
      tableId: string,
      field: { key: string; name: string; type: string }
    ) => {
      const created = { fieldId: `field-${field.key}`, name: field.name, type: field.type }
      const fields = remoteFields.get(tableId) ?? []
      fields.push(created)
      remoteFields.set(tableId, fields)
      return created
    }),
    listViews: vi.fn().mockResolvedValue([]),
    createView: vi.fn(async (_token: string, _table: string, view: { name: string }) => ({
      viewId: `view-${view.name}`
    })),
    configureView: vi.fn(),
    findRecord: vi.fn(async (_token: string, tableId: string, fieldName: string, value: string) => {
      const found = recordsFor(tableId).find((record) => record.fields[fieldName] === value)
      return found ? { recordId: found.recordId } : null
    }),
    listRecords: vi.fn(async (_token: string, tableId: string) => (
      recordsFor(tableId).map((record) => ({ ...record, fields: { ...record.fields } }))
    )),
    createRecord: vi.fn(async (_token: string, tableId: string, fields: Record<string, unknown>) => {
      const recordId = `record-${++nextRecord}`
      recordsFor(tableId).push({ recordId, fields: { ...fields } })
      return { recordId }
    }),
    createRecords: vi.fn(async (
      _token: string,
      tableId: string,
      records: Array<{ fields: Record<string, unknown> }>
    ) => records.map((record) => {
      const recordId = `record-${++nextRecord}`
      recordsFor(tableId).push({ recordId, fields: { ...record.fields } })
      return { recordId }
    })),
    updateRecord: vi.fn(async (
      _token: string,
      tableId: string,
      recordId: string,
      fields: Record<string, unknown>
    ) => {
      const record = recordsFor(tableId).find((candidate) => candidate.recordId === recordId)
      if (!record) throw new Error('FEISHU_API_1254043')
      record.fields = { ...fields }
    }),
    updateRecords: vi.fn(async (
      _token: string,
      tableId: string,
      records: Array<{ recordId: string; fields: Record<string, unknown> }>
    ) => {
      for (const update of records) {
        const record = recordsFor(tableId).find((candidate) => candidate.recordId === update.recordId)
        if (!record) throw new Error('FEISHU_API_1254043')
        record.fields = { ...update.fields }
      }
    }),
    deleteRecord: vi.fn(async (_token: string, tableId: string, recordId: string) => {
      const records = recordsFor(tableId)
      const index = records.findIndex((record) => record.recordId === recordId)
      if (index < 0) throw new Error('FEISHU_API_1254043')
      records.splice(index, 1)
    }),
    addRemoteRecord(tableId: string, recordId: string, fields: Record<string, unknown>) {
      recordsFor(tableId).push({ recordId, fields: { ...fields } })
    },
    addRemoteField(tableId: string, field: { fieldId: string; name: string; type: string }) {
      const fields = remoteFields.get(tableId) ?? []
      fields.push({ ...field })
      remoteFields.set(tableId, fields)
    },
    fieldsFor(tableId: string) {
      return (remoteFields.get(tableId) ?? []).map((field) => ({ ...field }))
    },
    recordsFor(tableId: string) {
      return recordsFor(tableId).map((record) => ({ ...record, fields: { ...record.fields } }))
    },
    remoteRecordCount() {
      return Array.from(remote.values()).reduce((total, records) => total + records.length, 0)
    }
  }
}

function seedCreatorAndWork(repositories: AppRepositories): void {
  repositories.creators.create({
    id: 'creator-1', platform: 'douyin', name: '对标账号',
    profileUrl: 'https://www.douyin.com/user/example', enabled: true,
    createdAt: '2026-07-25T00:00:00.000Z'
  })
  repositories.works.upsert(workFixture(1))
  repositories.snapshots.create({
    id: 'work-1:2026-07-25', workId: 'work-1',
    capturedAt: '2026-07-25T01:00:00.000Z',
    metrics: { likes: 20_000, comments: 20, shares: 10, collects: 5 }
  })
}

function workFixture(index: number) {
  return {
    id: `work-${index}`,
    creatorId: 'creator-1',
    platformWorkId: String(index),
    sourceType: 'douyin_monitor' as const,
    sourceKey: `douyin:${index}`,
    mediaPath: null,
    ownership: 'competitor' as const,
    title: `对标作品 ${index}`,
    publishedAt: '2026-07-25T00:00:00.000Z',
    originalUrl: `https://www.douyin.com/video/${index}`,
    downloadUrl: null,
    metrics: { likes: 20_000 + index, comments: 20, shares: 10, collects: 5 }
  }
}

function saveBinding(repositories: AppRepositories, appToken: string): void {
  repositories.feishu.saveBinding({
    appToken,
    baseName: '对标内容雷达',
    baseUrl: `https://example.feishu.cn/base/${appToken}`,
    schemaVersion: 1,
    status: 'connected',
    lastSyncedAt: null,
    errorMessage: null
  })
}

function saveTables(repositories: AppRepositories): void {
  for (const key of ['creators', 'works', 'worksArchive', 'snapshots', 'reports']) {
    repositories.feishu.saveTable({ tableKey: key, tableId: key })
  }
}
