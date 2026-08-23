import type { FeishuBitableApi, RemoteField, RemoteRecord } from './bitable'
import type {
  FeishuFieldDefinition,
  FeishuFieldType,
  FeishuTableDefinition,
  FeishuViewDefinition
} from './schema'

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
  error?: { log_id?: string }
}

interface WikiNodeResponse {
  node?: {
    obj_type?: unknown
    obj_token?: unknown
  }
}

export class FeishuHttpClient implements FeishuBitableApi {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly log?: (message: string, detail?: unknown) => void
  ) {}

  async resolveWikiNode(nodeToken: string): Promise<{ objType: string; objToken: string }> {
    const query = new URLSearchParams({ token: nodeToken })
    const data = await this.request<WikiNodeResponse>(
      `/wiki/v2/spaces/get_node?${query.toString()}`
    )
    return validateWikiNode(data)
  }

  async findBasesByName(name: string): Promise<Array<{ appToken: string; url: string }>> {
    const data = await this.request<{
      files?: Array<{ name?: string; token?: string; type?: string; url?: string }>
    }>(
      '/drive/v1/files/search',
      { method: 'POST', body: JSON.stringify({ search_key: name, count: 50 }) }
    )
    return (data.files ?? [])
      .filter((item) => item.name === name && item.type === 'bitable' && item.token)
      .map((item) => ({
        appToken: String(item.token),
        url: item.url ?? `https://feishu.cn/base/${String(item.token)}`
      }))
  }

  async createBase(name: string): Promise<{ appToken: string; url: string }> {
    const data = await this.request<{ app?: { app_token?: string; url?: string } }>('/bitable/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ name })
    })
    if (!data.app?.app_token) throw new Error('FEISHU_CREATE_BASE_INVALID_RESPONSE')
    return {
      appToken: data.app.app_token,
      url: data.app.url ?? `https://feishu.cn/base/${data.app.app_token}`
    }
  }

  async renameTable(appToken: string, tableId: string, name: string): Promise<void> {
    await this.request(`/bitable/v1/apps/${appToken}/tables/${tableId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    })
  }

  async renameField(
    appToken: string,
    tableId: string,
    fieldId: string,
    name: string,
    type: FeishuFieldType
  ): Promise<RemoteField> {
    const data = await this.request<{
      field?: { field_id?: string; field_name?: string; type?: number }
    }>(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ field_name: name, type: FIELD_TYPE[type] })
    })
    if (!data.field?.field_id) throw new Error('FEISHU_UPDATE_FIELD_INVALID_RESPONSE')
    return {
      fieldId: data.field.field_id,
      name: data.field.field_name ?? name,
      type: data.field.type ? fieldTypeFromNumber(data.field.type) : type
    }
  }

  async deleteField(appToken: string, tableId: string, fieldId: string): Promise<void> {
    await this.request(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`, {
      method: 'DELETE'
    })
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

  async listFields(appToken: string, tableId: string): Promise<RemoteField[]> {
    const data = await this.request<{ items?: Array<{ field_id: string; field_name: string; type: number }> }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`
    )
    return (data.items ?? []).map((field) => ({
      fieldId: field.field_id,
      name: field.field_name,
      type: fieldTypeFromNumber(field.type)
    }))
  }

  async createField(
    appToken: string,
    tableId: string,
    field: FeishuFieldDefinition,
    linkedTables: Partial<Record<FeishuTableDefinition['key'], string>> = {}
  ): Promise<RemoteField> {
    const data = await this.request<{ field?: { field_id?: string; field_name?: string; type?: number } }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      {
        method: 'POST',
        body: JSON.stringify({
          field_name: field.name,
          type: FIELD_TYPE[field.type],
          property:
            field.type === 'link' && field.linkTo && linkedTables[field.linkTo]
              ? { table_id: linkedTables[field.linkTo] }
              : undefined
        })
      }
    )
    if (!data.field?.field_id) throw new Error('FEISHU_CREATE_FIELD_INVALID_RESPONSE')
    return {
      fieldId: data.field.field_id,
      name: data.field.field_name ?? field.name,
      type: data.field.type ? fieldTypeFromNumber(data.field.type) : field.type
    }
  }

  async listViews(appToken: string, tableId: string): Promise<Array<{ viewId: string; name: string }>> {
    const data = await this.request<{ items?: Array<{ view_id: string; view_name: string }> }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/views?page_size=100`
    )
    return (data.items ?? []).map((view) => ({ viewId: view.view_id, name: view.view_name }))
  }

  async createView(
    appToken: string,
    tableId: string,
    view: FeishuViewDefinition
  ): Promise<{ viewId: string }> {
    const data = await this.request<{ view?: { view_id?: string } }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      {
      method: 'POST',
      body: JSON.stringify({ view_name: view.name, view_type: 'grid' })
      }
    )
    if (!data.view?.view_id) throw new Error('FEISHU_CREATE_VIEW_INVALID_RESPONSE')
    return { viewId: data.view.view_id }
  }

  async configureView(
    appToken: string,
    tableId: string,
    viewId: string,
    view: FeishuViewDefinition,
    fields: Record<string, RemoteField>
  ): Promise<void> {
    const filter = view.filters ?? (view.filter
      ? { conjunction: 'and' as const, conditions: [view.filter] }
      : null)
    const hiddenFieldIds = (view.hiddenFieldKeys ?? []).map((fieldKey) => {
      const field = fields[fieldKey]
      if (!field) throw new Error(`FEISHU_VIEW_FIELD_MISSING:${fieldKey}`)
      return field.fieldId
    })
    const property: Record<string, unknown> = {}
    if (hiddenFieldIds.length > 0) {
      const current = await this.request<{
        view?: { property?: { hidden_fields?: string[] } }
      }>(`/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`)
      property.hidden_fields = Array.from(new Set([
        ...(current.view?.property?.hidden_fields ?? []),
        ...hiddenFieldIds
      ]))
    }
    if (!filter && hiddenFieldIds.length === 0) return
    const conditions = (filter?.conditions ?? []).map((definition) => {
      const field = fields[definition.fieldKey]
      if (!field) throw new Error(`FEISHU_VIEW_FIELD_MISSING:${definition.fieldKey}`)
      const condition: Record<string, unknown> = {
        field_id: field.fieldId,
        operator: definition.operator
      }
      // 飞书 API 要求 isEmpty/isNotEmpty 条件的 value 字段应该 ABSENT (不传),
      // 传 '' 或 [] 都被视为非空被拒。其它操作(is/contains)的 value 必须是字符串数组。
      if (definition.operator !== 'isNotEmpty') {
        condition.value = JSON.stringify(
          definition.value === undefined ? [] : [definition.value]
        )
      }
      return condition
    })
    if (filter) {
      property.filter_info = {
        conjunction: filter.conjunction,
        conditions
      }
    }
    await this.request(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          property
        })
      }
    )
  }

  async findRecord(
    appToken: string,
    tableId: string,
    fieldName: string,
    value: string
  ): Promise<{ recordId: string } | null> {
    const data = await this.request<{ items?: Array<{ record_id: string }> }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: { conjunction: 'and', conditions: [{ field_name: fieldName, operator: 'is', value: [value] }] },
          page_size: 1
        })
      }
    )
    const recordId = data.items?.[0]?.record_id
    return recordId ? { recordId } : null
  }

  async listRecords(appToken: string, tableId: string): Promise<RemoteRecord[]> {
    const records: RemoteRecord[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({ page_size: '500' })
      if (pageToken) query.set('page_token', pageToken)
      const data = await this.request<{
        items?: Array<{ record_id?: string; fields?: Record<string, unknown> }>
        has_more?: boolean
        page_token?: string
      }>(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${query.toString()}`)

      for (const item of data.items ?? []) {
        if (!item.record_id) throw new Error('FEISHU_LIST_RECORDS_INVALID_RESPONSE')
        records.push({ recordId: item.record_id, fields: item.fields ?? {} })
      }
      if (data.has_more && !data.page_token) {
        throw new Error('FEISHU_LIST_RECORDS_INVALID_RESPONSE')
      }
      pageToken = data.has_more ? data.page_token : undefined
    } while (pageToken)
    return records
  }

  async createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>
  ): Promise<{ recordId: string }> {
    const data = await this.request<{ record?: { record_id?: string } }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
      method: 'POST',
      body: JSON.stringify({ fields })
      }
    )
    if (!data.record?.record_id) throw new Error('FEISHU_CREATE_RECORD_INVALID_RESPONSE')
    return { recordId: data.record.record_id }
  }

  async createRecords(
    appToken: string,
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ): Promise<Array<{ recordId: string }>> {
    if (!records.length) return []
    const data = await this.request<{
      records?: Array<{ record_id?: string }>
    }>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        body: JSON.stringify({ records })
      }
    )
    if (
      data.records?.length !== records.length
      || data.records.some((record) => !record.record_id)
    ) {
      throw new Error('FEISHU_BATCH_CREATE_INVALID_RESPONSE')
    }
    return data.records.map((record) => ({ recordId: String(record.record_id) }))
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

  async updateRecords(
    appToken: string,
    tableId: string,
    records: Array<{ recordId: string; fields: Record<string, unknown> }>
  ): Promise<void> {
    if (!records.length) return
    await this.request(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      {
        method: 'POST',
        body: JSON.stringify({
          records: records.map((record) => ({
            record_id: record.recordId,
            fields: record.fields
          }))
        })
      }
    )
  }

  async deleteRecord(appToken: string, tableId: string, recordId: string): Promise<void> {
    await this.request(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      { method: 'DELETE' }
    )
  }

  private async request<T = Record<string, never>>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `https://open.feishu.cn/open-apis${path}`
    this.log?.(`feishu api request ${init?.method ?? 'GET'} ${requestPathCategory(path)}`, {
      pathCategory: requestPathCategory(path)
    })
    const response = await this.fetchImplementation(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)')
      const failure = parseFailureMetadata(body)
      this.log?.(`feishu api FAILED ${response.status} ${requestPathCategory(path)}`, {
        status: response.status,
        method: init?.method ?? 'GET',
        pathCategory: requestPathCategory(path),
        code: failure.code,
        requestId: failure.requestId
      })
      throw new Error(formatHttpFailure(
        response.status,
        init?.method ?? 'GET',
        path,
        failure
      ))
    }
    let envelope: FeishuEnvelope<T>
    try {
      envelope = (await response.json()) as FeishuEnvelope<T>
    } catch {
      this.log?.(`feishu api INVALID_RESPONSE ${requestPathCategory(path)}`, {
        pathCategory: requestPathCategory(path)
      })
      throw new Error(`FEISHU_INVALID_RESPONSE:${requestPathCategory(path)}`)
    }
    if (envelope.code !== 0 || !envelope.data) {
      const requestId = safeRequestId(envelope.error?.log_id)
      this.log?.(`feishu api BIZ_ERROR ${envelope.code} ${requestPathCategory(path)}`, {
        code: envelope.code,
        pathCategory: requestPathCategory(path),
        requestId
      })
      throw new Error(formatApiFailure(envelope.code, path, requestId))
    }
    return envelope.data
  }
}

function validateWikiNode(data: WikiNodeResponse): { objType: string; objToken: string } {
  const objType = data.node?.obj_type
  const objToken = data.node?.obj_token
  if (typeof objType !== 'string' || !objType || typeof objToken !== 'string' || !objToken) {
    throw new Error('FEISHU_WIKI_NODE_INVALID_RESPONSE')
  }
  return { objType, objToken }
}

function parseFailureMetadata(body: string): { code?: number; requestId?: string } {
  let code: number | undefined
  let requestId: string | undefined
  try {
    const parsed = JSON.parse(body) as {
      code?: unknown
      error?: { message?: unknown, log_id?: unknown }
    }
    if (typeof parsed.code === 'number') code = parsed.code
    requestId = safeRequestId(parsed.error?.log_id)
  } catch {
    // The response body is intentionally not surfaced in logs or errors.
  }
  return { code, requestId }
}

function formatHttpFailure(
  status: number,
  method: string,
  path: string,
  failure: { code?: number; requestId?: string }
): string {
  const primaryCode = failure.code === undefined
    ? `FEISHU_HTTP_${status}`
    : `FEISHU_API_${failure.code}`
  const httpStatusLabel = failure.code === undefined ? '' : `HTTP_${status} `
  const requestIdLabel = failure.requestId ? ` REQUEST_ID_${failure.requestId}` : ''
  return `${primaryCode}:${httpStatusLabel}${method} ${requestPathCategory(path)}${requestIdLabel}`
}

function formatApiFailure(code: number, path: string, requestId?: string): string {
  const requestIdLabel = requestId ? ` REQUEST_ID_${requestId}` : ''
  return `FEISHU_API_${code}:${requestPathCategory(path)}${requestIdLabel}`
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
    ? value
    : undefined
}

function requestPathCategory(path: string): string {
  const pathname = path.split('?')[0]
  if (pathname === '/wiki/v2/spaces/get_node') return 'wiki.node'
  if (pathname.startsWith('/bitable/')) return 'bitable'
  if (pathname.startsWith('/drive/')) return 'drive'
  return 'open-api'
}

function fieldTypeFromNumber(type: number): FeishuFieldType | 'unknown' {
  const match = Object.entries(FIELD_TYPE).find(([, value]) => value === type)?.[0]
  return match ? match as FeishuFieldType : 'unknown'
}
