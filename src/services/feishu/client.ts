import type { FeishuBitableApi } from './bitable'
import type { FeishuFieldDefinition, FeishuTableDefinition } from './schema'

const FIELD_TYPE: Record<FeishuFieldDefinition['type'], number> = {
  text: 1,
  number: 2,
  date: 5,
  checkbox: 7,
  url: 15,
  link: 18
}

interface FeishuEnvelope<T> {
  code: number
  msg?: string
  data?: T
}

export class FeishuHttpClient implements FeishuBitableApi {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async findBaseByName(name: string): Promise<{ appToken: string } | null> {
    const data = await this.request<{ files?: Array<{ name?: string; token?: string; type?: string }> }>(
      '/drive/v1/files/search',
      { method: 'POST', body: JSON.stringify({ search_key: name, count: 50 }) }
    )
    const file = data.files?.find((item) => item.name === name && item.type === 'bitable')
    return file?.token ? { appToken: file.token } : null
  }

  async createBase(name: string): Promise<{ appToken: string }> {
    const data = await this.request<{ app?: { app_token?: string } }>('/bitable/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ name })
    })
    if (!data.app?.app_token) throw new Error('FEISHU_CREATE_BASE_INVALID_RESPONSE')
    return { appToken: data.app.app_token }
  }

  async listTables(appToken: string): Promise<Array<{ tableId: string; name: string }>> {
    const data = await this.request<{ items?: Array<{ table_id: string; name: string }> }>(
      `/bitable/v1/apps/${appToken}/tables?page_size=100`
    )
    return (data.items ?? []).map((table) => ({ tableId: table.table_id, name: table.name }))
  }

  async createTable(
    appToken: string,
    table: FeishuTableDefinition,
    linkedTables: Partial<Record<FeishuTableDefinition['key'], string>> = {}
  ): Promise<{ tableId: string }> {
    const fields = table.fields.map((field) => ({
      field_name: field.name,
      type: FIELD_TYPE[field.type],
      property:
        field.type === 'link' && field.linkTo && linkedTables[field.linkTo]
          ? { table_id: linkedTables[field.linkTo] }
          : undefined
    }))
    const data = await this.request<{ table_id?: string }>(
      `/bitable/v1/apps/${appToken}/tables`,
      {
        method: 'POST',
        body: JSON.stringify({
          table: { name: table.name, default_view_name: '默认视图', fields }
        })
      }
    )
    if (!data.table_id) throw new Error('FEISHU_CREATE_TABLE_INVALID_RESPONSE')
    return { tableId: data.table_id }
  }

  async listFields(appToken: string, tableId: string): Promise<Array<{ name: string }>> {
    const data = await this.request<{ items?: Array<{ field_name: string }> }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`
    )
    return (data.items ?? []).map((field) => ({ name: field.field_name }))
  }

  async findRecord(
    appToken: string,
    tableId: string,
    fieldName: string,
    value: string
  ): Promise<{ recordId: string } | null> {
    const escapedValue = value.replaceAll('"', '\\"')
    const data = await this.request<{ items?: Array<{ record_id: string }> }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: { conjunction: 'and', conditions: [{ field_name: fieldName, operator: 'is', value: [escapedValue] }] },
          page_size: 1
        })
      }
    )
    const recordId = data.items?.[0]?.record_id
    return recordId ? { recordId } : null
  }

  async createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    await this.request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ fields })
    })
  }

  async updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    await this.request(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      { method: 'PUT', body: JSON.stringify({ fields }) }
    )
  }

  private async request<T = Record<string, never>>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.fetchImplementation(`https://open.feishu.cn/open-apis${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    })
    if (!response.ok) throw new Error(`FEISHU_HTTP_${response.status}`)
    const envelope = (await response.json()) as FeishuEnvelope<T>
    if (envelope.code !== 0 || !envelope.data) {
      throw new Error(`FEISHU_API_${envelope.code}:${envelope.msg ?? 'unknown'}`)
    }
    return envelope.data
  }
}
