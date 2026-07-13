import { describe, expect, it, vi } from 'vitest'
import { ImportNotificationController } from '../../src/main/import-notifications'

function notification(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, () => void>()
  return {
    show: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
    removeAllListeners: vi.fn(),
    click: () => listeners.get('click')?.(),
    closed: () => listeners.get('close')?.(),
    ...overrides
  }
}

describe('import desktop notifications', () => {
  it('shows a Chinese completion notification and focuses only its work id on click', async () => {
    const item = notification()
    const create = vi.fn(() => item)
    const focusWork = vi.fn()
    const controller = new ImportNotificationController(create, focusWork)

    await controller.notify({
      workId: 'work-1', status: 'completed', stage: 'completed', errorCode: null, retryable: false
    })

    expect(create).toHaveBeenCalledWith({ title: '作品分析完成', body: '作品已完成转写和 AI 拆解，点击查看结果。' })
    expect(item.show).toHaveBeenCalledOnce()
    item.click()
    expect(focusWork).toHaveBeenCalledWith('work-1')
  })

  it('describes the failed stage and a retry next step', async () => {
    const item = notification()
    const create = vi.fn(() => item)
    const controller = new ImportNotificationController(create, vi.fn())

    await controller.notify({
      workId: 'work-2', status: 'failed', stage: 'transcribed', errorCode: 'AI_FAILED', retryable: true
    })

    expect(create).toHaveBeenCalledWith({
      title: '作品分析失败',
      body: 'AI 拆解阶段未完成，请打开作品分析后重试。'
    })
  })

  it('contains unsupported and throwing notification implementations', async () => {
    const unsupported = new ImportNotificationController(null, vi.fn())
    await expect(unsupported.notify({
      workId: 'work-1', status: 'completed', stage: 'completed', errorCode: null, retryable: false
    })).resolves.toBeUndefined()

    const throwing = new ImportNotificationController(() => { throw new Error('unavailable') }, vi.fn())
    await expect(throwing.notify({
      workId: 'work-1', status: 'completed', stage: 'completed', errorCode: null, retryable: false
    })).resolves.toBeUndefined()
  })

  it('releases notification listeners and closes active notifications on shutdown', async () => {
    const item = notification()
    const controller = new ImportNotificationController(() => item, vi.fn())
    await controller.notify({
      workId: 'work-1', status: 'completed', stage: 'completed', errorCode: null, retryable: false
    })

    controller.close()

    expect(item.removeAllListeners).toHaveBeenCalledOnce()
    expect(item.close).toHaveBeenCalledOnce()
  })
})
