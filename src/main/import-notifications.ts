import { randomUUID } from 'node:crypto'
import type { WorkflowStage } from '../core/workflow'
import type { ImportNotificationPort, ImportTerminalNotification } from '../services/import/import-service'
import type { WorkFocusRequest } from '../shared/ipc-contract'

export interface DesktopNotification {
  show(): void
  close(): void
  on(event: 'click' | 'close', listener: () => void): unknown
  removeAllListeners(): unknown
}

export type DesktopNotificationFactory = ((options: { title: string; body: string }) => DesktopNotification) | null

export class ImportNotificationController implements ImportNotificationPort {
  private readonly active = new Set<DesktopNotification>()

  constructor(
    private readonly createNotification: DesktopNotificationFactory,
    private readonly focusWork: (request: WorkFocusRequest) => void
  ) {}

  async notify(notification: ImportTerminalNotification): Promise<void> {
    if (!this.createNotification) return
    try {
      const item = this.createNotification(notificationText(notification))
      this.active.add(item)
      item.on('click', () => this.focusWork({ workId: notification.workId, requestId: randomUUID() }))
      item.on('close', () => this.active.delete(item))
      item.show()
    } catch {
      // Windows notifications may be unavailable; the persisted job remains authoritative.
    }
  }

  close(): void {
    for (const item of this.active) {
      try {
        item.removeAllListeners()
        item.close()
      } catch {
        // Shutdown continues even when the operating system already removed a toast.
      }
    }
    this.active.clear()
  }
}

function notificationText(notification: ImportTerminalNotification): { title: string; body: string } {
  if (notification.status === 'completed') {
    return { title: '作品分析完成', body: '作品已完成转写和 AI 拆解，点击查看结果。' }
  }
  const nextStep = notification.retryable ? '请打开作品分析后重试。' : '请打开作品分析查看处理建议。'
  return {
    title: '作品分析失败',
    body: `${failedStageLabel(notification.stage)}阶段未完成，${nextStep}`
  }
}

function failedStageLabel(stage: WorkflowStage): string {
  const labels: Record<WorkflowStage, string> = {
    discovered: '视频准备',
    downloaded: '音频提取',
    audio_extracted: '文字转写',
    transcribed: 'AI 拆解',
    analyzed: '结果保存',
    synced: '结果同步',
    completed: '任务收尾'
  }
  return labels[stage]
}
