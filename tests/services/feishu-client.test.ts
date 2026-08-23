import { describe, expect, it, vi } from 'vitest'
import { FeishuHttpClient } from '../../src/services/feishu/client'

describe('Feishu HTTP client', () => {
  it('resolves a Wiki node to its Bitable object', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { node: { obj_type: 'bitable', obj_token: 'bascnResolved' } }
    }), { status: 200 }))
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch)

    await expect(client.resolveWikiNode('wikcn123')).resolves.toEqual({
      objType: 'bitable',
      objToken: 'bascnResolved'
    })

    const [url, init] = fetchImplementation.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/open-apis/wiki/v2/spaces/get_node')
    expect(new URL(url).searchParams.get('token')).toBe('wikcn123')
    expect(init.method).toBeUndefined()
  })

  it('rejects a Wiki response without a node', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {}
    }), { status: 200 }))
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch)

    await expect(client.resolveWikiNode('wikcn123')).rejects.toThrow('FEISHU_WIKI_NODE_INVALID_RESPONSE')
  })

  it('keeps a nonzero Wiki API response to its stable code', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 999,
      msg: 'fake-wiki-response-secret'
    }), { status: 200 }))
    const log = vi.fn()
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch, log)

    const error = await client.resolveWikiNode('wikcn123').catch((caught) => caught as Error)

    expect(error.message).toBe('FEISHU_API_999:wiki.node')
    expect(error.message).not.toContain('fake-wiki-response-secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('fake-wiki-response-secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-access-token')
  })

  it('normalizes invalid Wiki JSON without exposing the response text', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      'fake-invalid-json-secret{',
      { status: 200 }
    ))
    const log = vi.fn()
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch, log)

    const error = await client.resolveWikiNode('wikcn123').catch((caught) => caught as Error)

    expect(error.message).toBe('FEISHU_INVALID_RESPONSE:wiki.node')
    expect(error.message).not.toContain('fake-invalid-json-secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('fake-invalid-json-secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-access-token')
  })

  it('omits a forged Wiki request ID from errors and logs', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 999,
      error: { log_id: 'safe-id\nforged-log-line' }
    }), { status: 200 }))
    const log = vi.fn()
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch, log)

    const error = await client.resolveWikiNode('wikcn123').catch((caught) => caught as Error)

    expect(error.message).toBe('FEISHU_API_999:wiki.node')
    expect(JSON.stringify(log.mock.calls)).not.toContain('forged-log-line')
    expect(JSON.stringify(log.mock.calls)).not.toContain('\n')
  })

  it('rejects a malformed Wiki node response', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { node: { obj_type: 'bitable' } }
    }), { status: 200 }))
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch)

    await expect(client.resolveWikiNode('wikcn123')).rejects.toThrow('FEISHU_WIKI_NODE_INVALID_RESPONSE')
  })

  it('keeps HTTP failure diagnostics to stable metadata', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 1254001,
      msg: 'The request body is wrong, please modify it.',
      error: {
        message: "Invalid request parameter: the primary field cannot be set as a hidden type.",
        log_id: 'log-123'
      }
    }), { status: 400 }))
    const log = vi.fn()
    const client = new FeishuHttpClient('test-access-token', fetchImplementation as typeof fetch, log)

    const error = await client.createRecords('base-1', 'terms', [
      { fields: { 词条ID: 'term-1' } }
    ]).catch((caught) => caught as Error)

    expect(error.message).toBe('FEISHU_API_1254001:HTTP_400 POST bitable REQUEST_ID_log-123')
    expect(error.message).not.toContain('Invalid request parameter')
    expect(JSON.stringify(log.mock.calls)).not.toContain('Invalid request parameter')
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-access-token')
    expect(JSON.stringify(log.mock.calls)).not.toContain('词条ID')
  })

  it('deletes an obsolete Base field', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {}
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.deleteField('base-1', 'directions', 'legacy-field')

    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining('/apps/base-1/tables/directions/fields/legacy-field'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('includes the required field type when renaming the default primary field', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { field: { field_id: 'field-primary', field_name: '博主ID', type: 1 } }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.renameField('base-1', 'creators', 'field-primary', '博主ID', 'text')

    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining('/fields/field-primary'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ field_name: '博主ID', type: 1 })
      })
    )
  })

  it('creates a view and applies its configured filter by field ID', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'view-1' } }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'view-1' } }
      }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    const created = await client.createView(
      'base-1',
      'works',
      {
        name: '我的作品',
        table: 'works',
        filter: { fieldKey: 'ownership', operator: 'is', value: '我的作品' }
      }
    )
    await client.configureView(
      'base-1',
      'works',
      created.viewId,
      {
        name: '我的作品',
        table: 'works',
        filter: { fieldKey: 'ownership', operator: 'is', value: '我的作品' }
      },
      {
        ownership: { fieldId: 'fld-ownership', name: '作品归属', type: 'text' }
      }
    )

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    const [patchUrl, patchInit] = fetchImplementation.mock.calls[1] as [string, RequestInit]
    expect(patchUrl).toContain('/views/view-1')
    expect(patchInit.method).toBe('PATCH')
    expect(JSON.parse(String(patchInit.body))).toEqual({
      property: {
        filter_info: {
          conjunction: 'and',
          conditions: [{
            field_id: 'fld-ownership',
            operator: 'is',
            value: '["我的作品"]'
          }]
        }
      }
    })
  })

  it('configures the super viral view with four absolute-metric filters joined by OR', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { view: { view_id: 'view-super' } }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.configureView(
      'base-1',
      'works',
      'view-super',
      {
        name: '🔥 超级爆款池',
        table: 'works',
        filters: {
          conjunction: 'or',
          conditions: [
            { fieldKey: 'highlightReasons', operator: 'contains', value: '绝对高点赞' },
            { fieldKey: 'highlightReasons', operator: 'contains', value: '高收藏' },
            { fieldKey: 'highlightReasons', operator: 'contains', value: '高评论' },
            { fieldKey: 'highlightReasons', operator: 'contains', value: '高转发' }
          ]
        }
      },
      {
        highlightReasons: { fieldId: 'fld-reasons', name: '入选原因', type: 'text' }
      }
    )

    const patch = JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body))
    expect(patch.property.filter_info).toEqual({
      conjunction: 'or',
      conditions: [
        { field_id: 'fld-reasons', operator: 'contains', value: '["绝对高点赞"]' },
        { field_id: 'fld-reasons', operator: 'contains', value: '["高收藏"]' },
        { field_id: 'fld-reasons', operator: 'contains', value: '["高评论"]' },
        { field_id: 'fld-reasons', operator: 'contains', value: '["高转发"]' }
      ]
    })
  })

  it('merges app-hidden fields with fields the user already hid', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { property: { hidden_fields: ['fld-user-hidden'] } } }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'view-1' } }
      }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.configureView(
      'base-1',
      'works',
      'view-1',
      { name: '默认视图', table: 'works', hiddenFieldKeys: ['accountType'] },
      { accountType: { fieldId: 'fld-account-type', name: '账号类型', type: 'text' } }
    )

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    const patch = JSON.parse(String(fetchImplementation.mock.calls[1][1]?.body))
    expect(patch.property.hidden_fields).toEqual(['fld-user-hidden', 'fld-account-type'])
  })

  it('uses the Drive URL returned by Feishu', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        files: [{
          name: '对标内容雷达',
          type: 'bitable',
          token: 'base-1',
          url: 'https://example.feishu.cn/base/base-1'
        }]
      }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await expect(client.findBasesByName('对标内容雷达')).resolves.toEqual([{
      appToken: 'base-1',
      url: 'https://example.feishu.cn/base/base-1'
    }])
  })

  it('omits the value field entirely for an is-not-empty view filter', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'view-1' } }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'view-1' } }
      }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    const created = await client.createView(
      'base-1',
      'works',
      {
        name: '钩子素材库',
        table: 'works',
        filter: { fieldKey: 'openingHook', operator: 'isNotEmpty' }
      }
    )
    await client.configureView(
      'base-1',
      'works',
      created.viewId,
      {
        name: '钩子素材库',
        table: 'works',
        filter: { fieldKey: 'openingHook', operator: 'isNotEmpty' }
      },
      {
        openingHook: { fieldId: 'fld-hook', name: '开头钩子', type: 'text' }
      }
    )

    const patch = JSON.parse(String(fetchImplementation.mock.calls[1][1]?.body))
    // 飞书要求 isEmpty/isNotEmpty 条件的 value 字段 ABSENT（不传），否则 400。
    expect(patch.property.filter_info.conditions[0]).not.toHaveProperty('value')
  })

  it('lets JSON encoding escape record identity values exactly once', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { items: [] }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.findRecord('base-1', 'works', '作品ID', 'work-"quoted"')

    const body = JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body))
    expect(body.filter.conditions[0].value).toEqual(['work-"quoted"'])
  })

  it('preserves unsupported user-defined fields without blocking schema checks', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        items: [
          { field_id: 'fld-work-id', field_name: '作品ID', type: 1 },
          { field_id: 'fld-user-select', field_name: '我的分类', type: 3 }
        ]
      }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await expect(client.listFields('base-1', 'works')).resolves.toEqual([
      { fieldId: 'fld-work-id', name: '作品ID', type: 'text' },
      { fieldId: 'fld-user-select', name: '我的分类', type: 'unknown' }
    ])
  })

  it('lists all records across Feishu pagination', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ record_id: 'record-1', fields: { 作品ID: 'work-1' } }],
          has_more: true,
          page_token: 'next page'
        }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ record_id: 'record-2', fields: { 作品ID: 'work-2' } }],
          has_more: false
        }
      }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await expect(client.listRecords('base-1', 'works')).resolves.toEqual([
      { recordId: 'record-1', fields: { 作品ID: 'work-1' } },
      { recordId: 'record-2', fields: { 作品ID: 'work-2' } }
    ])

    expect(String(fetchImplementation.mock.calls[0][0])).toContain('/records?page_size=500')
    expect(new URL(String(fetchImplementation.mock.calls[1][0])).searchParams.get('page_token'))
      .toBe('next page')
  })

  it('creates records with the batch endpoint', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        records: [
          { record_id: 'record-1' },
          { record_id: 'record-2' }
        ]
      }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await expect(client.createRecords('base-1', 'works', [
      { fields: { 作品ID: 'work-1' } },
      { fields: { 作品ID: 'work-2' } }
    ])).resolves.toEqual([
      { recordId: 'record-1' },
      { recordId: 'record-2' }
    ])

    const [url, init] = fetchImplementation.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/records/batch_create')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      records: [
        { fields: { 作品ID: 'work-1' } },
        { fields: { 作品ID: 'work-2' } }
      ]
    })
  })

  it('updates records with the batch endpoint', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        records: [{ record_id: 'record-1' }]
      }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await client.updateRecords('base-1', 'works', [
      { recordId: 'record-1', fields: { 作品ID: 'work-1', 标题: '更新后' } }
    ])

    const [url, init] = fetchImplementation.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/records/batch_update')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      records: [{ record_id: 'record-1', fields: { 作品ID: 'work-1', 标题: '更新后' } }]
    })
  })

  it('rejects a batch-create response with missing record IDs', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { records: [{ record_id: 'record-1' }, {}] }
    }), { status: 200 }))
    const client = new FeishuHttpClient('token', fetchImplementation as typeof fetch)

    await expect(client.createRecords('base-1', 'works', [
      { fields: { 作品ID: 'work-1' } },
      { fields: { 作品ID: 'work-2' } }
    ])).rejects.toThrow('FEISHU_BATCH_CREATE_INVALID_RESPONSE')
  })
})
