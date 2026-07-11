import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateStatus } from '../../src/renderer/src/components/UpdateStatus'

describe('automatic update status', () => {
  it('shows download progress', () => {
    render(<UpdateStatus initialState={{ status: 'downloading', percent: 42 }} />)
    expect(screen.getByText('正在下载更新 42%')).toBeInTheDocument()
  })

  it('explains waiting and automatic installation states', () => {
    const { rerender } = render(<UpdateStatus initialState={{ status: 'waiting_for_idle', version: '0.2.0' }} />)
    expect(screen.getByText('任务完成后自动更新')).toBeInTheDocument()
    rerender(<UpdateStatus initialState={{ status: 'installing' }} />)
    expect(screen.getByText('正在自动更新')).toBeInTheDocument()
  })

  it('offers retry after a failure', () => {
    const retry = vi.fn()
    render(<UpdateStatus initialState={{ status: 'error', message: '自动更新暂时不可用，稍后会重试。' }} onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: '重试更新' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when idle or already current', () => {
    const { container, rerender } = render(<UpdateStatus initialState={{ status: 'idle' }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<UpdateStatus initialState={{ status: 'up_to_date' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
