import { FEISHU_BASE_SCHEMA, type FeishuTableDefinition } from './schema'

export interface ProvisionedBase {
  appToken: string
  tables: Record<FeishuTableDefinition['key'], string>
}

export interface FeishuBitableApi {
  findBaseByName(name: string): Promise<{ appToken: string } | null>
  createBase(name: string): Promise<{ appToken: string }>
  listTables(appToken: string): Promise<Array<{ tableId: string; name: string }>>
  createTable(
    appToken: string,
    table: FeishuTableDefinition,
    linkedTables?: Partial<Record<FeishuTableDefinition['key'], string>>
  ): Promise<{ tableId: string }>
  listFields?(
    appToken: string,
    tableId: string
  ): Promise<Array<{ name: string }>>
  findRecord(
    appToken: string,
    tableId: string,
    fieldName: string,
    value: string
  ): Promise<{ recordId: string } | null>
  createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>
  ): Promise<void>
  updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<void>
}

export class FeishuSyncService {
  constructor(private readonly api: FeishuBitableApi) {}

  async ensureBase(): Promise<ProvisionedBase> {
    const existing = await this.api.findBaseByName(FEISHU_BASE_SCHEMA.name)
    const base = existing ?? (await this.api.createBase(FEISHU_BASE_SCHEMA.name))
    const existingTables = await this.api.listTables(base.appToken)
    const tables = {} as ProvisionedBase['tables']

    for (const definition of FEISHU_BASE_SCHEMA.tables) {
      const found = existingTables.find((table) => table.name === definition.name)
      const tableId = found?.tableId ?? (await this.api.createTable(base.appToken, definition, tables)).tableId
      tables[definition.key] = tableId

      if (found && this.api.listFields) {
        const fields = await this.api.listFields(base.appToken, tableId)
        const present = new Set(fields.map((field) => field.name))
        const missing = definition.fields.filter((field) => !present.has(field.name))
        if (missing.length > 0) {
          throw new Error(`FEISHU_SCHEMA_MISSING_FIELDS:${definition.name}:${missing.map((f) => f.name).join(',')}`)
        }
      }
    }

    return { appToken: base.appToken, tables }
  }

  async upsert(
    base: ProvisionedBase,
    table: FeishuTableDefinition['key'],
    identityField: string,
    identityValue: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    const tableId = base.tables[table]
    const payload = { [identityField]: identityValue, ...fields }
    const existing = await this.api.findRecord(
      base.appToken,
      tableId,
      identityField,
      identityValue
    )
    if (existing) {
      await this.api.updateRecord(base.appToken, tableId, existing.recordId, payload)
    } else {
      await this.api.createRecord(base.appToken, tableId, payload)
    }
  }
}
