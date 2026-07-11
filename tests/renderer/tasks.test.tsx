import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TasksPage } from '../../src/renderer/src/pages/TasksPage'

describe('task history', () => {
  it('retries from the failed stage with an actionable explanation', () => {
    const retry = vi.fn()
    render(<TasksPage onRetry={retry} />)
    expect(screen.getByText('AI 账户余额不足')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '从 AI 拆解阶段重试' }))
    expect(retry).toHaveBeenCalledWith('task-2')
  })
})
