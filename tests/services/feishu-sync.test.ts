import { describe, expect, it, vi } from 'vitest'
import { FeishuSyncService } from '../../src/services/feishu/bitable'
import { sendWebhookNotification } from '../../src/services/feishu/notifications'

describe('Feishu synchronization', () => {
  it('creates missing tables and upserts existing records idempotently', async () => {
    const api = {
      findBaseByName: vi.fn().mockResolvedValue(null),
      createBase: vi.fn().mockResolvedValue({ appToken: 'base-1' }),
      listTables: vi.fn().mockResolvedValue([]),
      createTable: vi.fn(async (_token: string, table: { key: string }) => ({ tableId: table.key })),
      findRecord: vi.fn().mockResolvedValue({ recordId: 'record-1' }),
      createRecord: vi.fn(),
      updateRecord: vi.fn()
    }
    const service = new FeishuSyncService(api)

    const provisioned = await service.ensureBase()
    await service.upsert(provisioned, 'works', '作品ID', 'work-1', { 标题: '测试作品' })

    expect(api.createBase).toHaveBeenCalledWith('对标内容雷达')
    expect(api.createTable).toHaveBeenCalledTimes(4)
    expect(api.updateRecord).toHaveBeenCalledWith('base-1', 'works', 'record-1', {
      作品ID: 'work-1',
      标题: '测试作品'
    })
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('sends a concise actionable webhook card', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await sendWebhookNotification(
      'https://open.feishu.cn/open-apis/bot/v2/hook/example',
      { title: '今日分析完成', summary: '新增 3 条，今日重点 1 条' },
      fetcher as typeof fetch
    )
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { msg_type: string }
    expect(request.msg_type).toBe('interactive')
  })
})
