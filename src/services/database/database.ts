import Database from 'better-sqlite3'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { MIGRATIONS } from './migrations'

export class AppDatabase {
  readonly connection: Database.Database

  constructor(readonly path: string) {
    const connection = new Database(path)
    const requiresMigration = Number(connection.pragma('user_version', { simple: true })) < MIGRATIONS.length

    if (path !== ':memory:' && requiresMigration && existsSync(path) && statSync(path).size > 0) {
      connection.close()
      copyFileSync(path, `${path}.backup-${Date.now()}`)
      this.connection = new Database(path)
    } else {
      this.connection = connection
    }

    this.connection.pragma('foreign_keys = ON')
    this.connection.pragma('journal_mode = WAL')
    this.migrate()
  }

  get schemaVersion(): number {
    return Number(this.connection.pragma('user_version', { simple: true }))
  }

  migrate(): void {
    const currentVersion = this.schemaVersion
    if (currentVersion >= MIGRATIONS.length) return

    this.connection.transaction(() => {
      for (let index = currentVersion; index < MIGRATIONS.length; index += 1) {
        this.connection.exec(MIGRATIONS[index])
        this.connection.pragma(`user_version = ${index + 1}`)
      }
    })()
  }

  close(): void {
    if (this.connection.open) this.connection.close()
  }
}
