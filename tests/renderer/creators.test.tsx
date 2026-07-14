import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreatorsPage } from '../../src/renderer/src/pages/CreatorsPage'

describe('creator management', () => {
  it('adds a valid Douyin creator URL', () => {
    render(<CreatorsPage initialCreators={[]} />)
    fireEvent.change(screen.getByLabelText('抖音博主主页'), {
      target: { value: 'https://www.douyin.com/user/example' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加博主' }))
    expect(screen.getByText('等待首次采集')).toBeInTheDocument()
  })

  it('accepts a complete Douyin creator card message', () => {
    render(<CreatorsPage initialCreators={[]} />)
    const input = screen.getByLabelText('抖音博主主页')
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.change(input, {
      target: { value: '长按复制此条消息 https://v.douyin.com/jI79SWk4jwA/ 2@9.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加博主' }))
    expect(screen.getByText('等待首次采集')).toBeInTheDocument()
  })

  it('blocks additions after ten creators', () => {
    const creators = Array.from({ length: 10 }, (_, index) => ({
      id: String(index), name: `博主 ${index + 1}`, profileUrl: `https://www.douyin.com/user/${index}`,
      enabled: true, works: 30, lastRun: '今天 09:00', status: 'ready' as const
    }))
    render(<CreatorsPage initialCreators={creators} />)
    expect(screen.getByRole('button', { name: '添加博主' })).toBeDisabled()
    expect(screen.getByText('已达到 10 位上限')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a creator', () => {
    render(<CreatorsPage initialCreators={[{
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting'
    }]} />)

    fireEvent.click(screen.getByRole('button', { name: '删除测试博主' }))
    expect(screen.getByRole('dialog', { name: '删除测试博主？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(screen.queryByText('测试博主')).not.toBeInTheDocument()
  })
})
