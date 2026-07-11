import type { UpdateState } from '../shared/ipc-contract'

export interface UpdaterAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
  checkForUpdatesAndNotify(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface VersionEvent {
  version?: string
}

interface ProgressEvent {
  percent?: number
}

export class UpdateService {
  private state: UpdateState = { status: 'idle' }
  private downloadedVersion: string | null = null
  private readonly listeners = new Set<(state: UpdateState) => void>()

  constructor(
    private readonly updater: UpdaterAdapter,
    private readonly isBusinessIdle: () => boolean,
    private readonly prepareInstall: () => void = () => undefined
  ) {
    this.bindEvents()
  }

  async start(): Promise<void> {
    this.updater.autoDownload = true
    this.updater.autoInstallOnAppQuit = false
    await this.retry()
  }

  getState(): UpdateState {
    return this.state
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async retry(): Promise<void> {
    try {
      await this.updater.checkForUpdatesAndNotify()
    } catch {
      this.setState({ status: 'error', message: '自动更新暂时不可用，稍后会重试。' })
    }
  }

  notifyBusinessIdle(): void {
    if (!this.downloadedVersion || !this.isBusinessIdle()) return
    this.setState({ status: 'installing' })
    this.prepareInstall()
    this.updater.quitAndInstall(true, true)
  }

  private bindEvents(): void {
    this.updater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    this.updater.on('update-available', (value) => {
      const version = (value as VersionEvent | undefined)?.version ?? '新版本'
      this.setState({ status: 'available', version })
    })
    this.updater.on('update-not-available', () => this.setState({ status: 'up_to_date' }))
    this.updater.on('download-progress', (value) => {
      const raw = Number((value as ProgressEvent | undefined)?.percent ?? 0)
      this.setState({ status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(raw))) })
    })
    this.updater.on('update-downloaded', (value) => {
      this.downloadedVersion = (value as VersionEvent | undefined)?.version ?? '新版本'
      if (this.isBusinessIdle()) this.notifyBusinessIdle()
      else this.setState({ status: 'waiting_for_idle', version: this.downloadedVersion })
    })
    this.updater.on('error', () => {
      this.setState({ status: 'error', message: '自动更新暂时不可用，稍后会重试。' })
    })
  }

  private setState(state: UpdateState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}
