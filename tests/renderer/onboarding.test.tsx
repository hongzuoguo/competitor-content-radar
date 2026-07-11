import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SetupWizard } from '../../src/renderer/src/features/onboarding/SetupWizard'

describe('first-run setup wizard', () => {
  it('guides the user through login, AI, Feishu, creator and schedule', () => {
    const complete = vi.fn()
    render(<SetupWizard onComplete={complete} />)
    expect(screen.getByRole('heading', { name: '连接抖音账号' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '我已完成登录' }))
    expect(screen.getByRole('heading', { name: '选择 AI 拆解模型' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }))
    expect(screen.getByRole('heading', { name: '连接飞书' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过飞书' }))
    fireEvent.change(screen.getByLabelText('第一个博主主页'), { target: { value: 'https://www.douyin.com/user/example' } })
    fireEvent.click(screen.getByRole('button', { name: '添加并继续' }))
    expect(screen.getByRole('heading', { name: '确认自动运行时间' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完成设置' }))
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
