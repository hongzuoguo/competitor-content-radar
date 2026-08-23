import {
  FEISHU_BASE_SCHEMA,
  type FeishuFieldDefinition,
  type FeishuFieldType,
  type FeishuTableDefinition,
  type FeishuTableKey,
  type FeishuViewDefinition
} from './schema'

export interface FeishuBaseCandidate {
  appToken: string
  url: string
}

export interface RemoteField {
  fieldId: string
  name: string
  type: FeishuFieldType | 'unknown'
}

export interface RemoteRecord {
  recordId: string
  fields: Record<string, unknown>
}

export interface ProvisionedBase {
  appToken: string
  url: string
  schemaVersion: number
  tables: Record<FeishuTableKey, string>
  fields?: Partial<Record<FeishuTableKey, Record<string, RemoteField>>>
}

export interface FeishuUpsertItem {
  localId: string
  identityValue: string
  fields: Record<string, unknown>
}

export interface FeishuBitableApi {
  findBasesByName(name: string): Promise<FeishuBaseCandidate[]>
  createBase(name: string): Promise<FeishuBaseCandidate>
  listTables(appToken: string): Promise<Array<{ tableId: string; name: string }>>
  renameTable(appToken: string, tableId: string, name: string): Promise<void>
  renameField(
    appToken: string,
    tableId: string,
    fieldId: string,
    name: string,
    type: FeishuFieldType
  ): Promise<RemoteField>
  deleteField(appToken: string, tableId: string, fieldId: string): Promise<void>
  createTable(
    appToken: string,
    table: FeishuTableDefinition,
    linkedTables?: Partial<Record<FeishuTableKey, string>>
  ): Promise<{ tableId: string }>
  listFields(appToken: string, tableId: string): Promise<RemoteField[]>
  createField(
    appToken: string,
    tableId: string,
    field: FeishuFieldDefinition,
    linkedTables?: Partial<Record<FeishuTableKey, string>>
  ): Promise<RemoteField>
  listViews(appToken: string, tableId: string): Promise<Array<{ viewId: string; name: string }>>
  createView(
    appToken: string,
    tableId: string,
    view: FeishuViewDefinition
  ): Promise<{ viewId: string }>
  configureView(
    appToken: string,
    tableId: string,
    viewId: string,
    view: FeishuViewDefinition,
    fields: Record<string, RemoteField>
  ): Promise<void>
  findRecord(
    appToken: string,
    tableId: string,
    fieldName: string,
    value: string
  ): Promise<{ recordId: string } | null>
  listRecords(appToken: string, tableId: string): Promise<RemoteRecord[]>
  createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>
  ): Promise<{ recordId: string }>
  createRecords(
    appToken: string,
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ): Promise<Array<{ recordId: string }>>
  updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<void>
  updateRecords(
    appToken: string,
    tableId: string,
    records: Array<{ recordId: string; fields: Record<string, unknown> }>
  ): Promise<void>
  deleteRecord(appToken: string, tableId: string, recordId: string): Promise<void>
}

export class FeishuBaseSelectionError extends Error {
  readonly code = 'FEISHU_BASE_SELECTION_REQUIRED'

  constructor(readonly candidates: FeishuBaseCandidate[]) {
    super('找到多份同名多维表格，请选择要继续维护的一份')
  }
}

export class FeishuSchemaError extends Error {
  readonly code = 'FEISHU_SCHEMA_NEEDS_REPAIR'

  constructor(message: string) {
    super(message)
  }
}

function isCompatibleFieldType(expected: FeishuFieldType, actual: RemoteField['type']): boolean {
  return expected === actual || (expected === 'url' && actual === 'text')
}

const LEGACY_REPORT_FIELD_NAMES = new Set([
  '类型',
  '统计周期',
  '采集作品数',
  '本周爆款数',
  '升温作品数',
  '点赞增长',
  '主题趋势',
  '生成时间'
])

export class FeishuBaseMissingError extends Error {
  readonly code = 'FEISHU_BASE_MISSING'

  constructor() {
    super('已连接的多维表格不存在，请确认是否被删除')
  }
}

export class FeishuSyncService {
  constructor(readonly api: FeishuBitableApi) {}

  async ensureBase(
    selectedAppToken?: string,
    knownFields: Partial<Record<FeishuTableKey, Record<string, RemoteField>>> = {},
    options: { repairDeletedFields?: boolean } = {}
  ): Promise<ProvisionedBase> {
    // Drive search can fail on user_access_token (e.g. 400) for some scopes.
    // Treat search failures as "no candidates" so we fall back to createBase
    // instead of blocking the connect flow.
    let candidates: Array<{ appToken: string; url: string }> = []
    try {
      candidates = await this.api.findBasesByName(FEISHU_BASE_SCHEMA.name)
    } catch {
      // Drive search can fail on user_access_token (e.g. 400). Treat as
      // "no candidates" so we fall back to createBase instead of blocking
      // the connect flow.
      candidates = []
    }
    let base = selectedAppToken
      ? candidates.find((candidate) => candidate.appToken === selectedAppToken)
      : undefined

    if (!base) {
      if (selectedAppToken) {
        base = {
          appToken: selectedAppToken,
          url: `https://feishu.cn/base/${selectedAppToken}`
        }
      } else {
        if (candidates.length > 1) throw new FeishuBaseSelectionError(candidates)
        base = candidates[0] ?? (await this.api.createBase(FEISHU_BASE_SCHEMA.name))
      }
    }

    let existingTables: Awaited<ReturnType<FeishuBitableApi['listTables']>>
    try {
      existingTables = await this.api.listTables(base.appToken)
    } catch (error) {
      if (
        selectedAppToken
        && error instanceof Error
        && (error.message.includes('FEISHU_HTTP_404') || error.message.startsWith('FEISHU_API_1254040'))
      ) {
        throw new FeishuBaseMissingError()
      }
      throw error
    }
    const tables = {} as Record<FeishuTableKey, string>
    const fields: Partial<Record<FeishuTableKey, Record<string, RemoteField>>> = {}
    const newlyCreated = new Set<string>()
    const reusedDefault = new Set<string>()
    const reusedLegacyReports = new Set<string>()

    for (const [index, definition] of FEISHU_BASE_SCHEMA.tables.entries()) {
      let found = existingTables.find((table) => table.name === definition.name)
      if (!found && definition.key === 'directions') {
        const legacyReports = existingTables.find((table) => table.name === '报告')
        if (legacyReports) {
          const legacyRecords = await this.api.listRecords(base.appToken, legacyReports.tableId)
          for (const record of legacyRecords) {
            const reportId = record.fields['报告ID']
            if (typeof reportId === 'string' && reportId.trim()) {
              await this.api.deleteRecord(base.appToken, legacyReports.tableId, record.recordId)
            }
          }
          await this.api.renameTable(base.appToken, legacyReports.tableId, definition.name)
          reusedLegacyReports.add(legacyReports.tableId)
          found = legacyReports
        }
      }
      if (found) {
        tables[definition.key] = found.tableId
        continue
      }

      if (
        index === 0
        && existingTables.length === 1
        && isDefaultTableName(existingTables[0].name)
      ) {
        const defaultTable = existingTables[0]
        await this.api.renameTable(base.appToken, defaultTable.tableId, definition.name)
        tables[definition.key] = defaultTable.tableId
        reusedDefault.add(defaultTable.tableId)
        continue
      }

      const created = await this.api.createTable(base.appToken, definition, tables)
      tables[definition.key] = created.tableId
      newlyCreated.add(created.tableId)
    }

    for (const definition of FEISHU_BASE_SCHEMA.tables) {
      const tableId = tables[definition.key]
      let remoteFields = await this.api.listFields(base.appToken, tableId)

      if (definition.key === 'directions') {
        const legacyFields = remoteFields.filter((field) => LEGACY_REPORT_FIELD_NAMES.has(field.name))
        for (const field of legacyFields) {
          await this.api.deleteField(base.appToken, tableId, field.fieldId)
        }
        remoteFields = remoteFields.filter((field) => !LEGACY_REPORT_FIELD_NAMES.has(field.name))
      }

      const byName = new Map(remoteFields.map((field) => [field.name, field]))

      for (const field of definition.fields) {
        const known = knownFields[definition.key]?.[field.key]
        let existing = known
          ? remoteFields.find((candidate) => candidate.fieldId === known.fieldId) ?? byName.get(field.name)
          : byName.get(field.name)
        if (
          definition.key === 'growthTop10'
          && field.key === 'growthRate'
          && (!existing || existing.name === '近7天增速')
        ) {
          const legacyGrowthRate = existing?.name === '近7天增速'
            ? existing
            : byName.get('近7天增速')
          if (legacyGrowthRate) {
            const renamed = await this.api.renameField(
              base.appToken,
              tableId,
              legacyGrowthRate.fieldId,
              field.name,
              field.type
            )
            const fieldIndex = remoteFields.findIndex((candidate) => candidate.fieldId === legacyGrowthRate.fieldId)
            if (fieldIndex >= 0) remoteFields[fieldIndex] = renamed
            byName.delete(legacyGrowthRate.name)
            byName.set(renamed.name, renamed)
            existing = renamed
          }
        }
        if (
          !known
          && !existing
          && reusedLegacyReports.has(tableId)
          && field === definition.fields[0]
        ) {
          const legacyPrimary = byName.get('报告ID')
          if (legacyPrimary) {
            const renamed = await this.api.renameField(
              base.appToken,
              tableId,
              legacyPrimary.fieldId,
              field.name,
              field.type
            )
            const fieldIndex = remoteFields.findIndex((candidate) => candidate.fieldId === legacyPrimary.fieldId)
            if (fieldIndex >= 0) remoteFields[fieldIndex] = renamed
            byName.delete(legacyPrimary.name)
            byName.set(renamed.name, renamed)
            existing = renamed
          }
        }
        if (
          !known
          && !existing
          && reusedDefault.has(tableId)
          && field === definition.fields[0]
          && remoteFields[0]
        ) {
          const primaryField = remoteFields[0]
          if (!isCompatibleFieldType(field.type, primaryField.type)) {
            throw new FeishuSchemaError(
              `${definition.name}中的主字段类型不兼容，请恢复为${field.type}后重试`
            )
          }
          const renamed = await this.api.renameField(
            base.appToken,
            tableId,
            primaryField.fieldId,
            field.name,
            field.type
          )
          remoteFields[0] = renamed
          byName.delete(primaryField.name)
          byName.set(renamed.name, renamed)
          existing = renamed
        }
        if (known && !existing) {
          if (!options.repairDeletedFields) {
            throw new FeishuSchemaError(
              `${definition.name}中的核心字段“${known.name}”已被删除，请恢复后重试`
            )
          }
          existing = await this.api.createField(base.appToken, tableId, field, tables)
          remoteFields.push(existing)
          byName.set(existing.name, existing)
        }
        if (existing && !isCompatibleFieldType(field.type, existing.type)) {
          throw new FeishuSchemaError(
            `${definition.name}中的核心字段“${field.name}”类型不兼容，请恢复为${field.type}后重试`
          )
        }
        if (!existing && !newlyCreated.has(tableId)) {
          const created = await this.api.createField(base.appToken, tableId, field, tables)
          remoteFields.push(created)
          byName.set(field.name, created)
        }
      }

      // A newly created table includes all fields in the create-table request.
      // Test doubles may not return them from listFields, so only create missing
      // fields for the reused default table and existing tables.
      if (!newlyCreated.has(tableId) && remoteFields.length === 0) {
        for (const field of definition.fields) {
          if (byName.has(field.name)) continue
          const created = await this.api.createField(base.appToken, tableId, field, tables)
          remoteFields.push(created)
          byName.set(field.name, created)
        }
      }

      fields[definition.key] = Object.fromEntries(
        definition.fields
          .map((field) => {
            const known = knownFields[definition.key]?.[field.key]
            const remote = known
              ? remoteFields.find((candidate) => candidate.fieldId === known.fieldId) ?? byName.get(field.name)
              : byName.get(field.name)
            return [field.key, remote] as const
          })
          .filter((entry): entry is [string, RemoteField] => Boolean(entry[1]))
      )
    }

    const existingViews = await this.api.listViews(base.appToken, tables.works)
    for (const view of FEISHU_BASE_SCHEMA.views) {
      const existing = existingViews.find((candidate) => candidate.name === view.name)
      const viewId = existing?.viewId
        ?? (await this.api.createView(base.appToken, tables[view.table], view)).viewId
      await this.api.configureView(
        base.appToken,
        tables[view.table],
        viewId,
        view,
        fields[view.table] ?? {}
      )
    }

    for (const definition of FEISHU_BASE_SCHEMA.tables) {
      const hiddenFieldKeys = definition.defaultViewHiddenFieldKeys ?? []
      if (hiddenFieldKeys.length === 0) continue
      const tableViews = definition.key === 'works'
        ? existingViews
        : await this.api.listViews(base.appToken, tables[definition.key])
      const defaultView = tableViews.find((view) => ['默认视图', '表格'].includes(view.name))
      if (!defaultView) continue
      await this.api.configureView(
        base.appToken,
        tables[definition.key],
        defaultView.viewId,
        { name: defaultView.name, table: definition.key, hiddenFieldKeys },
        fields[definition.key] ?? {}
      )
    }

    return {
      appToken: base.appToken,
      url: base.url,
      schemaVersion: FEISHU_BASE_SCHEMA.version,
      tables,
      fields
    }
  }

  async upsert(
    base: ProvisionedBase,
    table: FeishuTableKey,
    identityField: string,
    identityValue: string,
    fields: Record<string, unknown>,
    knownRecordId?: string | null
  ): Promise<string> {
    const tableId = base.tables[table]
    const payload = { [identityField]: identityValue, ...fields }
    const existing = knownRecordId
      ? { recordId: knownRecordId }
      : await this.api.findRecord(base.appToken, tableId, identityField, identityValue)

    if (existing) {
      try {
        await this.api.updateRecord(base.appToken, tableId, existing.recordId, payload)
        return existing.recordId
      } catch (error) {
        if (!knownRecordId || !isMissingRecord(error)) throw error
      }
    }

    if (knownRecordId) {
      const recovered = await this.api.findRecord(
        base.appToken,
        tableId,
        identityField,
        identityValue
      )
      if (recovered) {
        await this.api.updateRecord(base.appToken, tableId, recovered.recordId, payload)
        return recovered.recordId
      }
    }

    const created = await this.api.createRecord(base.appToken, tableId, payload)
    return created.recordId
  }

  async upsertMany(
    base: ProvisionedBase,
    table: FeishuTableKey,
    identityField: string,
    items: FeishuUpsertItem[]
  ): Promise<Array<{ localId: string; recordId: string }>> {
    if (!items.length) return []
    const tableId = base.tables[table]
    const remoteRecords = await this.api.listRecords(base.appToken, tableId)
    const remoteByIdentity = new Map<string, string>()
    for (const record of remoteRecords) {
      const value = record.fields[identityField]
      if (typeof value !== 'string' && typeof value !== 'number') continue
      const identity = String(value)
      if (remoteByIdentity.has(identity)) {
        throw new Error('FEISHU_DUPLICATE_REMOTE_IDENTITY')
      }
      remoteByIdentity.set(identity, record.recordId)
    }

    const localIds = new Set<string>()
    const identities = new Set<string>()
    const creates: Array<{ item: FeishuUpsertItem; fields: Record<string, unknown> }> = []
    const updates: Array<{
      item: FeishuUpsertItem
      recordId: string
      fields: Record<string, unknown>
    }> = []
    for (const item of items) {
      if (localIds.has(item.localId) || identities.has(item.identityValue)) {
        throw new Error('FEISHU_DUPLICATE_LOCAL_IDENTITY')
      }
      localIds.add(item.localId)
      identities.add(item.identityValue)
      const fields = { [identityField]: item.identityValue, ...item.fields }
      const recordId = remoteByIdentity.get(item.identityValue)
      if (recordId) updates.push({ item, recordId, fields })
      else creates.push({ item, fields })
    }

    const mappings = new Map<string, string>()
    for (const chunk of chunks(updates, 500)) {
      await this.api.updateRecords(
        base.appToken,
        tableId,
        chunk.map(({ recordId, fields }) => ({ recordId, fields }))
      )
      for (const item of chunk) mappings.set(item.item.localId, item.recordId)
    }
    for (const chunk of chunks(creates, 500)) {
      const created = await this.api.createRecords(
        base.appToken,
        tableId,
        chunk.map(({ fields }) => ({ fields }))
      )
      if (created.length !== chunk.length) {
        throw new Error('FEISHU_BATCH_CREATE_INVALID_RESPONSE')
      }
      for (const [index, result] of created.entries()) {
        mappings.set(chunk[index].item.localId, result.recordId)
      }
    }

    return items.map((item) => {
      const recordId = mappings.get(item.localId)
      if (!recordId) throw new Error('FEISHU_BATCH_MAPPING_MISSING')
      return { localId: item.localId, recordId }
    })
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function isMissingRecord(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /^FEISHU_HTTP_404(?::|$)/.test(error.message)
    || /^FEISHU_API_125404\d(?::|$)/.test(error.message)
    || /^FEISHU_(?:API|HTTP)_\d+:HTTP_404(?:\s|$)/.test(error.message)
}

function isDefaultTableName(name: string): boolean {
  return name === '数据表' || name === 'Table1'
}
