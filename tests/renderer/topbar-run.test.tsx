import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '../../src/renderer/src/components/Topbar'

describe('topbar run feedback', () => {
  afterEach(() => vi.restoreAllMocks())

  function installDesktopApi(runNow: () => Promise<{ accepted: boolean; reason?: string }>): void {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        runNow,
        getUpdateState: vi.fn().mockResolvedValue({ status: 'idle' }),
        onUpdateState: vi.fn().mockReturnValue(() => undefined)
      }
    })
  }

  it('shows the fixed 08:00 daily monitoring time', () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)

    expect(screen.getByText(/08:00/)).toBeVisible()
    expect(screen.queryByText(/09:00/)).not.toBeInTheDocument()
  })

  it('shows visible confirmation as soon as a run is accepted', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))

    expect(await screen.findByText('任务已启动，请到总览查看进度')).toBeVisible()
  })

  it('shows the rejection reason instead of failing silently', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: false, reason: '请先完成 AI 模型设置' }))

    render(<Topbar />)
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))

    expect(await screen.findByText('请先完成 AI 模型设置')).toBeVisible()
  })
})
