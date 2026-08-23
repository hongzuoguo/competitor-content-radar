import { describe, expect, it, vi } from 'vitest'
import {
  FeishuBaseMissingError,
  FeishuSchemaError,
  FeishuSyncService
} from '../../src/services/feishu/bitable'
import { FeishuHttpClient } from '../../src/services/feishu/client'

function api(overrides: Record<string, unknown> = {}) {
  return {
    findBasesByName: vi.fn().mockResolvedValue([]),
    createBase: vi.fn().mockResolvedValue({ appToken: 'base-1', url: 'https://example.feishu.cn/base/base-1' }),
    listTables: vi.fn().mockResolvedValue([{ tableId: 'default-table', name: '数据表' }]),
    renameTable: vi.fn(),
    renameField: vi.fn(async (_token: string, _tableId: string, fieldId: string, name: string, type: string) => ({
      fieldId, name, type
    })),
    deleteField: vi.fn(),
    createTable: vi.fn(async (_token: string, table: { key: string }) => ({ tableId: table.key })),
    listFields: vi.fn().mockResolvedValue([]),
    createField: vi.fn(async (_token: string, _tableId: string, field: { key: string; name: string; type: string }) => ({
      fieldId: `fld-${field.key}`,
      name: field.name,
      type: field.type
    })),
    listViews: vi.fn().mockResolvedValue([]),
    createView: vi.fn(async (_token: string, _tableId: string, view: { name: string }) => ({
      viewId: `view-${view.name}`
    })),
    configureView: vi.fn(),
    findRecord: vi.fn().mockResolvedValue(null),
    listRecords: vi.fn().mockResolvedValue([]),
    createRecord: vi.fn().mockResolvedValue({ recordId: 'record-new' }),
    createRecords: vi.fn(async (_token: string, _tableId: string, records: unknown[]) => (
      records.map((_, index) => ({ recordId: `record-batch-${index}` }))
    )),
    updateRecord: vi.fn(),
    updateRecords: vi.fn(),
    deleteRecord: vi.fn(),
    ...overrides
  }
}

describe('Feishu synchronization', () => {
  it('reuses the default table and provisions the remaining six tables with fields and views', async () => {
    const client = api()
    const service = new FeishuSyncService(client)

    const provisioned = await service.ensureBase()

    expect(client.createBase).toHaveBeenCalledWith('对标内容雷达')
    expect(client.renameTable).toHaveBeenCalledWith('base-1', 'default-table', '博主')
    expect(client.createTable).toHaveBeenCalledTimes(6)
    expect(Object.keys(provisioned.tables)).toEqual([
      'creators', 'works', 'worksArchive', 'snapshots', 'growthTop10', 'directions', 'contentTerms'
    ])
    expect(client.createField).toHaveBeenCalled()
    expect(client.createView).toHaveBeenCalledTimes(8)
    expect(client.configureView).toHaveBeenCalledTimes(8)
  })

  it('hides compatibility fields in existing default views', async () => {
    const configureView = vi.fn()
    const client = api({
      listViews: vi.fn(async (_token: string, tableId: string) => (
        ['works', 'worksArchive', 'directions', 'contentTerms'].includes(tableId)
          ? [{ viewId: `default-${tableId}`, name: '默认视图' }]
          : []
      )),
      configureView
    })

    await new FeishuSyncService(client).ensureBase()

    expect(configureView).toHaveBeenCalledWith(
      'base-1', 'works', 'default-works',
      expect.objectContaining({ hiddenFieldKeys: ['accountType'] }),
      expect.anything()
    )
    expect(configureView).toHaveBeenCalledWith(
      'base-1', 'worksArchive', 'default-worksArchive',
      expect.objectContaining({ hiddenFieldKeys: ['accountType'] }),
      expect.anything()
    )
    expect(configureView).not.toHaveBeenCalledWith(
      'base-1', 'directions', 'default-directions', expect.anything(), expect.anything()
    )
    expect(configureView).not.toHaveBeenCalledWith(
      'base-1', 'contentTerms', 'default-contentTerms', expect.anything(), expect.anything()
    )
  })

  it('reuses the default table when resuming after Base creation was interrupted', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-interrupted', url: 'https://example/base-interrupted' }
      ]),
      listTables: vi.fn().mockResolvedValue([{ tableId: 'default-table', name: '数据表' }])
    })

    const result = await new FeishuSyncService(client).ensureBase()

    expect(client.renameTable).toHaveBeenCalledWith('base-interrupted', 'default-table', '博主')
    expect(client.createTable).toHaveBeenCalledTimes(6)
    expect(result.tables.creators).toBe('default-table')
  })

  it('reapplies a view filter after creation succeeded but its first configuration failed', async () => {
    let worksViewCalls = 0
    const listViews = vi.fn(async (_token: string, tableId: string) => {
      if (tableId !== 'works') return []
      worksViewCalls += 1
      return worksViewCalls === 1
        ? []
        : [{ viewId: 'view-super', name: '🔥 超级爆款池' }]
    })
    const configureView = vi.fn()
      .mockRejectedValueOnce(new Error('FEISHU_HTTP_429'))
      .mockResolvedValue(undefined)
    const client = api({ listViews, configureView })
    const service = new FeishuSyncService(client)

    await expect(service.ensureBase()).rejects.toThrow('FEISHU_HTTP_429')
    await expect(service.ensureBase()).resolves.toBeTruthy()

    expect(client.createView.mock.calls.filter((call) => call[2].name === '🔥 超级爆款池'))
      .toHaveLength(1)
    expect(configureView).toHaveBeenCalledWith(
      'base-1',
      'works',
      'view-super',
      expect.objectContaining({ name: '🔥 超级爆款池' }),
      expect.anything()
    )
  })

  it('binds the reused default table primary field to 博主ID', async () => {
    const client = api({
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'default-table'
          ? [{ fieldId: 'default-primary', name: '文本', type: 'text' }]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase()

    expect(client.renameField).toHaveBeenCalledWith(
      'base-1',
      'default-table',
      'default-primary',
      '博主ID',
      'text'
    )
    expect(result.fields?.creators?.creatorId).toEqual({
      fieldId: 'default-primary',
      name: '博主ID',
      type: 'text'
    })
  })

  it('adds missing fields but preserves user fields on an existing Base', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-existing', url: 'https://example.feishu.cn/base/base-existing' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'worksArchive', name: '归档作品' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'growthTop10', name: '近7天增速TOP10' },
        { tableId: 'directions', name: '创作方向' },
        { tableId: 'contentTerms', name: '热门内容词' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'works'
          ? [
              { fieldId: 'work-id', name: '作品ID', type: 'text' },
              { fieldId: 'custom', name: '我的备注', type: 'text' }
            ]
          : []
      ))
    })

    await new FeishuSyncService(client).ensureBase()

    expect(client.createBase).not.toHaveBeenCalled()
    expect(client.createTable).not.toHaveBeenCalled()
    expect(client.createField).not.toHaveBeenCalledWith(
      'base-existing',
      'works',
      expect.objectContaining({ name: '我的备注' }),
      expect.anything()
    )
  })

  it('renames the existing growth-rate field to include its percentage unit', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-existing', url: 'https://example.feishu.cn/base/base-existing' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'worksArchive', name: '归档作品' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'growthTop10', name: '近7天增速TOP10' },
        { tableId: 'directions', name: '创作方向' },
        { tableId: 'contentTerms', name: '热门内容词' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'growthTop10'
          ? [{ fieldId: 'growth-rate', name: '近7天增速', type: 'number' }]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase('base-existing')

    expect(client.renameField).toHaveBeenCalledWith(
      'base-existing', 'growthTop10', 'growth-rate', '近7天增速（%）', 'number'
    )
    expect(client.createField).not.toHaveBeenCalledWith(
      'base-existing',
      'growthTop10',
      expect.objectContaining({ key: 'growthRate' }),
      expect.anything()
    )
    expect(result.fields?.growthTop10?.growthRate?.name).toBe('近7天增速（%）')
  })

  it('renames the legacy report table to creative directions instead of creating a duplicate', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-existing', url: 'https://example.feishu.cn/base/base-existing' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'worksArchive', name: '归档作品' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'growthTop10', name: '近7天增速TOP10' },
        { tableId: 'legacy-reports', name: '报告' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'legacy-reports'
          ? [
              { fieldId: 'legacy-report-id', name: '报告ID', type: 'text' },
              { fieldId: 'legacy-type', name: '类型', type: 'text' },
              { fieldId: 'legacy-period', name: '统计周期', type: 'text' },
              { fieldId: 'legacy-trend', name: '主题趋势', type: 'text' },
              { fieldId: 'custom-note', name: '用户备注', type: 'text' }
            ]
          : []
      )),
      listRecords: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'legacy-reports'
          ? [
              { recordId: 'old-report', fields: { 报告ID: 'weekly:2026-08-03' } },
              { recordId: 'manual-row', fields: { 报告ID: '', 用户备注: '保留' } }
            ]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase('base-existing')

    expect(client.renameTable).toHaveBeenCalledWith('base-existing', 'legacy-reports', '创作方向')
    expect(client.deleteRecord).toHaveBeenCalledWith('base-existing', 'legacy-reports', 'old-report')
    expect(client.deleteRecord).not.toHaveBeenCalledWith('base-existing', 'legacy-reports', 'manual-row')
    expect(client.renameField).toHaveBeenCalledWith(
      'base-existing', 'legacy-reports', 'legacy-report-id', '方向ID', 'text'
    )
    expect(client.deleteField).toHaveBeenCalledWith('base-existing', 'legacy-reports', 'legacy-type')
    expect(client.deleteField).toHaveBeenCalledWith('base-existing', 'legacy-reports', 'legacy-period')
    expect(client.deleteField).toHaveBeenCalledWith('base-existing', 'legacy-reports', 'legacy-trend')
    expect(client.deleteField).not.toHaveBeenCalledWith('base-existing', 'legacy-reports', 'custom-note')
    expect(result.tables.directions).toBe('legacy-reports')
    expect(client.createTable).not.toHaveBeenCalledWith(
      'base-existing', expect.objectContaining({ key: 'directions' }), expect.anything()
    )
  })

  it('removes legacy weekly-report fields from an already migrated creative-directions table', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-existing', url: 'https://example.feishu.cn/base/base-existing' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'worksArchive', name: '归档作品' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'growthTop10', name: '近7天增速TOP10' },
        { tableId: 'directions', name: '创作方向' },
        { tableId: 'contentTerms', name: '热门内容词' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'directions'
          ? [
              { fieldId: 'direction-id', name: '方向ID', type: 'text' },
              { fieldId: 'legacy-count', name: '本周爆款数', type: 'number' },
              { fieldId: 'legacy-created', name: '生成时间', type: 'date' },
              { fieldId: 'custom-note', name: '用户备注', type: 'text' }
            ]
          : []
      ))
    })

    await new FeishuSyncService(client).ensureBase('base-existing')

    expect(client.deleteField).toHaveBeenCalledWith('base-existing', 'directions', 'legacy-count')
    expect(client.deleteField).toHaveBeenCalledWith('base-existing', 'directions', 'legacy-created')
    expect(client.deleteField).not.toHaveBeenCalledWith('base-existing', 'directions', 'custom-note')
  })

  it('accepts a text field when the template stores a URL as plain text', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-existing', url: 'https://example.feishu.cn/base/base-existing' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'worksArchive', name: '归档作品' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'growthTop10', name: '近7天增速TOP10' },
        { tableId: 'directions', name: '创作方向' },
        { tableId: 'contentTerms', name: '热门内容词' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'worksArchive'
          ? [{ fieldId: 'archive-url', name: '原视频', type: 'text' }]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase('base-existing')

    expect(result.fields?.worksArchive?.originalUrl).toEqual({
      fieldId: 'archive-url',
      name: '原视频',
      type: 'text'
    })
  })

  it('requires the user to choose when multiple same-name bases exist', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-1', url: 'https://example.feishu.cn/base/base-1' },
        { appToken: 'base-2', url: 'https://example.feishu.cn/base/base-2' }
      ])
    })

    await expect(new FeishuSyncService(client).ensureBase()).rejects.toMatchObject({
      code: 'FEISHU_BASE_SELECTION_REQUIRED',
      candidates: expect.arrayContaining([expect.objectContaining({ appToken: 'base-1' })])
    })
    expect(client.createBase).not.toHaveBeenCalled()
  })

  it('pauses when an existing core field has an incompatible type', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([{ appToken: 'base-1', url: 'https://example/base-1' }]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'reports', name: '报告' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'works'
          ? [{ fieldId: 'work-id', name: '作品ID', type: 'number' }]
          : []
      ))
    })

    await expect(new FeishuSyncService(client).ensureBase()).rejects.toBeInstanceOf(FeishuSchemaError)
  })

  it('resolves a renamed core field by its saved field ID', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([{ appToken: 'base-1', url: 'https://example/base-1' }]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'reports', name: '报告' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'works'
          ? [{ fieldId: 'work-id', name: '我的作品编号', type: 'text' }]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase('base-1', {
      works: {
        workId: { fieldId: 'work-id', name: '作品ID', type: 'text' }
      }
    })

    expect(result.fields?.works?.workId.name).toBe('我的作品编号')
    expect(client.createField).not.toHaveBeenCalledWith(
      'base-1',
      'works',
      expect.objectContaining({ key: 'workId' }),
      expect.anything()
    )
  })

  it('continues using a selected Base after the user renames it', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'reports', name: '报告' }
      ])
    })

    const result = await new FeishuSyncService(client).ensureBase('base-renamed')

    expect(result.appToken).toBe('base-renamed')
    expect(client.createBase).not.toHaveBeenCalled()
    expect(client.listTables).toHaveBeenCalledWith('base-renamed')
  })

  it('does not silently recreate a deleted selected Base', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([]),
      listTables: vi.fn().mockRejectedValue(new Error('FEISHU_API_1254040:AppNotFound'))
    })

    await expect(new FeishuSyncService(client).ensureBase('base-deleted'))
      .rejects.toBeInstanceOf(FeishuBaseMissingError)
    expect(client.createBase).not.toHaveBeenCalled()
  })

  it('recreates a deleted core field only during an explicit repair', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-1', url: 'https://example/base-1' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'reports', name: '报告' }
      ]),
      listFields: vi.fn().mockResolvedValue([])
    })

    await new FeishuSyncService(client).ensureBase(
      'base-1',
      {
        works: {
          workId: { fieldId: 'deleted-work-id', name: '作品ID', type: 'text' }
        }
      },
      { repairDeletedFields: true }
    )

    expect(client.createField).toHaveBeenCalledWith(
      'base-1',
      'works',
      expect.objectContaining({ key: 'workId', name: '作品ID' }),
      expect.anything()
    )
  })

  it('rebinds a core field that the user manually recreated with the same name and type', async () => {
    const client = api({
      findBasesByName: vi.fn().mockResolvedValue([
        { appToken: 'base-1', url: 'https://example/base-1' }
      ]),
      listTables: vi.fn().mockResolvedValue([
        { tableId: 'creators', name: '博主' },
        { tableId: 'works', name: '作品分析' },
        { tableId: 'snapshots', name: '每日指标快照' },
        { tableId: 'reports', name: '报告' }
      ]),
      listFields: vi.fn().mockImplementation(async (_token: string, tableId: string) => (
        tableId === 'works'
          ? [{ fieldId: 'replacement-work-id', name: '作品ID', type: 'text' }]
          : []
      ))
    })

    const result = await new FeishuSyncService(client).ensureBase('base-1', {
      works: {
        workId: { fieldId: 'deleted-work-id', name: '作品ID', type: 'text' }
      }
    })

    expect(result.fields?.works?.workId.fieldId).toBe('replacement-work-id')
    expect(client.createField).not.toHaveBeenCalledWith(
      'base-1',
      'works',
      expect.objectContaining({ key: 'workId' }),
      expect.anything()
    )
  })

  it('upserts by a known record mapping without searching again', async () => {
    const client = api()
    const service = new FeishuSyncService(client)
    const base = {
      appToken: 'base-1',
      url: 'https://example.feishu.cn/base/base-1',
      schemaVersion: 2,
      tables: provisionedTables()
    } as const

    const recordId = await service.upsert(
      base,
      'works',
      '作品ID',
      'work-1',
      { 标题: '测试作品' },
      'record-1'
    )

    expect(client.findRecord).not.toHaveBeenCalled()
    expect(client.updateRecord).toHaveBeenCalledWith('base-1', 'works', 'record-1', {
      作品ID: 'work-1',
      标题: '测试作品'
    })
    expect(recordId).toBe('record-1')
  })

  it('recovers when a saved record mapping points to a deleted Feishu row', async () => {
    const client = api({
      updateRecord: vi.fn()
        .mockRejectedValueOnce(new Error('FEISHU_API_1254043'))
        .mockResolvedValueOnce(undefined),
      findRecord: vi.fn().mockResolvedValue(null),
      createRecord: vi.fn().mockResolvedValue({ recordId: 'record-recreated' })
    })
    const service = new FeishuSyncService(client)
    const base = {
      appToken: 'base-1',
      url: 'https://example.feishu.cn/base/base-1',
      schemaVersion: 2,
      tables: provisionedTables()
    } as const

    const recordId = await service.upsert(
      base,
      'works',
      '作品ID',
      'work-1',
      { 标题: '测试作品' },
      'record-deleted'
    )

    expect(client.findRecord).toHaveBeenCalledWith('base-1', 'works', '作品ID', 'work-1')
    expect(client.createRecord).toHaveBeenCalledOnce()
    expect(recordId).toBe('record-recreated')
  })

  it.each([
    ['with a Feishu API code', JSON.stringify({ code: 1254001 })],
    ['without a Feishu API code', '{}']
  ])('recovers a deleted saved record when the real client receives HTTP 404 %s', async (_case, body) => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { record: { record_id: 'record-recreated' } }
      }), { status: 200 }))
    const service = new FeishuSyncService(
      new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch)
    )
    const base = {
      appToken: 'base-1',
      url: 'https://example.feishu.cn/base/base-1',
      schemaVersion: 2,
      tables: provisionedTables()
    } as const

    await expect(service.upsert(
      base,
      'works',
      '作品ID',
      'work-1',
      { 标题: '测试作品' },
      'record-deleted'
    )).resolves.toBe('record-recreated')
  })

  it('bulk-upserts by indexing remote identities once', async () => {
    const client = api({
      listRecords: vi.fn().mockResolvedValue([
        { recordId: 'record-existing', fields: { 作品ID: 'work-1' } }
      ]),
      createRecords: vi.fn().mockResolvedValue([{ recordId: 'record-created' }])
    })
    const service = new FeishuSyncService(client)
    const base = provisionedBase()

    await expect(service.upsertMany(base, 'works', '作品ID', [
      { localId: 'work-1', identityValue: 'work-1', fields: { 标题: '已存在' } },
      { localId: 'work-2', identityValue: 'work-2', fields: { 标题: '新作品' } }
    ])).resolves.toEqual([
      { localId: 'work-1', recordId: 'record-existing' },
      { localId: 'work-2', recordId: 'record-created' }
    ])

    expect(client.listRecords).toHaveBeenCalledOnce()
    expect(client.updateRecords).toHaveBeenCalledWith('base-1', 'works', [{
      recordId: 'record-existing',
      fields: { 作品ID: 'work-1', 标题: '已存在' }
    }])
    expect(client.createRecords).toHaveBeenCalledWith('base-1', 'works', [{
      fields: { 作品ID: 'work-2', 标题: '新作品' }
    }])
  })

  it('chunks bulk creates at 500 records without using single-record creates', async () => {
    let created = 0
    const client = api({
      createRecords: vi.fn(async (_token: string, _tableId: string, records: unknown[]) => (
        records.map(() => ({ recordId: `record-${created++}` }))
      ))
    })
    const service = new FeishuSyncService(client)
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      localId: `work-${index}`,
      identityValue: `work-${index}`,
      fields: { 标题: `作品 ${index}` }
    }))

    const mappings = await service.upsertMany(
      provisionedBase(),
      'works',
      '作品ID',
      items
    )

    expect(client.createRecords).toHaveBeenCalledTimes(3)
    expect(client.createRecords.mock.calls.map((call) => call[2].length)).toEqual([500, 500, 1])
    expect(client.createRecord).not.toHaveBeenCalled()
    expect(mappings).toHaveLength(1_001)
    expect(mappings[1_000]).toEqual({ localId: 'work-1000', recordId: 'record-1000' })
  })

  it('rejects duplicate remote identity values instead of guessing', async () => {
    const client = api({
      listRecords: vi.fn().mockResolvedValue([
        { recordId: 'record-1', fields: { 作品ID: 'work-1' } },
        { recordId: 'record-2', fields: { 作品ID: 'work-1' } }
      ])
    })
    const service = new FeishuSyncService(client)

    await expect(service.upsertMany(provisionedBase(), 'works', '作品ID', [{
      localId: 'work-1',
      identityValue: 'work-1',
      fields: { 标题: '无法判断更新哪一条' }
    }])).rejects.toThrow('FEISHU_DUPLICATE_REMOTE_IDENTITY')
    expect(client.createRecords).not.toHaveBeenCalled()
    expect(client.updateRecords).not.toHaveBeenCalled()
  })
})

function provisionedBase() {
  return {
    appToken: 'base-1',
    url: 'https://example.feishu.cn/base/base-1',
    schemaVersion: 2,
    tables: provisionedTables()
  } as const
}

function provisionedTables() {
  return {
    creators: 'creators',
    works: 'works',
    worksArchive: 'worksArchive',
    snapshots: 'snapshots',
    growthTop10: 'growthTop10',
    directions: 'directions',
    contentTerms: 'contentTerms'
  } as const
}
