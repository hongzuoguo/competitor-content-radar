import Database from 'better-sqlite3'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { MIGRATIONS } from './migrations'

const CREATOR_OWNERSHIP_MIGRATION_INDEX = 9
const FEISHU_FIRST_SYNC_MIGRATION_INDEX = 7

function hasColumn(connection: Database.Database, table: string, column: string): boolean {
  return (connection.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .some((candidate) => candidate.name === column)
}

function needsKnownSchemaRepair(connection: Database.Database, schemaVersion: number): boolean {
  return (
    schemaVersion > FEISHU_FIRST_SYNC_MIGRATION_INDEX
    && !hasColumn(connection, 'feishu_record_mappings', 'first_synced_at')
  ) || (
    schemaVersion > CREATOR_OWNERSHIP_MIGRATION_INDEX
    && !hasColumn(connection, 'creators', 'ownership')
  )
}

export class AppDatabase {
  readonly connection: Database.Database

  constructor(readonly path: string) {
    const connection = new Database(path)
    const schemaVersion = Number(connection.pragma('user_version', { simple: true }))
    const requiresMigration = schemaVersion < MIGRATIONS.length
    const requiresSchemaRepair = needsKnownSchemaRepair(connection, schemaVersion)

    if (path !== ':memory:' && (requiresMigration || requiresSchemaRepair) && existsSync(path) && statSync(path).size > 0) {
      connection.close()
      copyFileSync(path, `${path}.backup-${Date.now()}`)
      this.connection = new Database(path)
    } else {
      this.connection = connection
    }

    this.connection.pragma('foreign_keys = ON')
    this.connection.pragma('journal_mode = WAL')
    try {
      this.migrate()
    } catch (error) {
      this.close()
      throw error
    }
  }

  get schemaVersion(): number {
    return Number(this.connection.pragma('user_version', { simple: true }))
  }

  migrate(): void {
    const currentVersion = this.schemaVersion

    const foreignKeysEnabled = Boolean(this.connection.pragma('foreign_keys', { simple: true }))
    if (foreignKeysEnabled) this.connection.pragma('foreign_keys = OFF')
    try {
      this.connection.transaction(() => {
        if (
          currentVersion > FEISHU_FIRST_SYNC_MIGRATION_INDEX
          && !hasColumn(this.connection, 'feishu_record_mappings', 'first_synced_at')
        ) {
          this.connection.exec('ALTER TABLE feishu_record_mappings ADD COLUMN first_synced_at TEXT')
        }
        if (
          currentVersion > CREATOR_OWNERSHIP_MIGRATION_INDEX
          && !hasColumn(this.connection, 'creators', 'ownership')
        ) {
          this.connection.exec("ALTER TABLE creators ADD COLUMN ownership TEXT NOT NULL DEFAULT 'competitor'")
        }
        for (let index = currentVersion; index < MIGRATIONS.length; index += 1) {
          const firstSyncAlreadyExists = index === FEISHU_FIRST_SYNC_MIGRATION_INDEX
            && hasColumn(this.connection, 'feishu_record_mappings', 'first_synced_at')
          const ownershipAlreadyExists = index === CREATOR_OWNERSHIP_MIGRATION_INDEX
            && hasColumn(this.connection, 'creators', 'ownership')
          if (!firstSyncAlreadyExists && !ownershipAlreadyExists) this.connection.exec(MIGRATIONS[index])
          this.connection.pragma(`user_version = ${index + 1}`)
        }
        const violations = this.connection.pragma('foreign_key_check') as unknown[]
        if (violations.length > 0) throw new Error('Database migration failed foreign key check')
      })()
    } finally {
      if (foreignKeysEnabled) this.connection.pragma('foreign_keys = ON')
    }
  }

  close(): void {
    if (this.connection.open) this.connection.close()
  }
}
