import { safeStorage } from 'electron'
import type { SettingsRepository } from '../database/repositories'

export class SecretStore {
  constructor(private readonly settings: Pick<SettingsRepository, 'get' | 'set'>) {}

  set(key: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE')
    const encrypted = safeStorage.encryptString(value).toString('base64')
    this.settings.set(`secret.${key}`, encrypted)
  }

  get(key: string): string | null {
    const encrypted = this.settings.get<string>(`secret.${key}`)
    if (!encrypted) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE')
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
}
