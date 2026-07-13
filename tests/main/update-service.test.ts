import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { UpdateService, type UpdaterAdapter } from '../../src/main/update-service'

class FakeUpdater extends EventEmitter implements UpdaterAdapter {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdatesAndNotify = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

describe('automatic update service', () => {
  it('normalizes progress and installs a downloaded update only when business is idle', async () => {
    vi.useFakeTimers()
    const updater = new FakeUpdater()
    let idle = false
    const installOrder: string[] = []
    updater.quitAndInstall.mockImplementation(() => installOrder.push('quit'))
    const service = new UpdateService(updater, () => idle, () => installOrder.push('prepare'))

    await service.start()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)

    updater.emit('download-progress', { percent: 142 })
    expect(service.getState()).toEqual({ status: 'downloading', percent: 100 })

    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(service.getState()).toEqual({ status: 'waiting_for_idle', version: '0.2.0' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    idle = true
    service.notifyBusinessIdle()
    expect(service.getState()).toEqual({ status: 'installing' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(installOrder).toEqual(['prepare', 'quit'])
    vi.useRealTimers()
  })

  it('awaits asynchronous shutdown before installing an update', async () => {
    vi.useFakeTimers()
    const updater = new FakeUpdater()
    let release!: () => void
    const shutdown = new Promise<void>((resolve) => { release = resolve })
    const service = new UpdateService(updater, () => true, () => shutdown)
    await service.start()
    updater.emit('update-downloaded', { version: '0.3.0' })
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    release()
    await vi.runAllTimersAsync()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    vi.useRealTimers()
  })

  it('does not install when asynchronous shutdown fails', async () => {
    vi.useFakeTimers()
    const updater = new FakeUpdater()
    const service = new UpdateService(updater, () => true, async () => { throw new Error('SHUTDOWN_FAILED') })
    await service.start()
    updater.emit('update-downloaded', { version: '0.3.0' })
    await vi.runAllTimersAsync()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(service.getState().status).toBe('error')
    vi.useRealTimers()
  })

  it('keeps the current version usable when update checks fail', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService(updater, () => true)
    await service.start()

    updater.emit('error', new Error('token=C:\\secret'))

    expect(service.getState()).toEqual({ status: 'error', message: '自动更新暂时不可用，稍后会重试。' })
  })

  it('maps checking, availability and no-update events', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService(updater, () => true)
    const states: string[] = []
    service.subscribe((state) => states.push(state.status))
    await service.start()

    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('update-not-available')

    expect(states).toEqual(['checking', 'available', 'up_to_date'])
  })
})
