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

  it('blocks additions after ten creators', () => {
    const creators = Array.from({ length: 10 }, (_, index) => ({
      id: String(index), name: `博主 ${index + 1}`, profileUrl: `https://www.douyin.com/user/${index}`,
      enabled: true, works: 30, lastRun: '今天 09:00', status: 'ready' as const
    }))
    render(<CreatorsPage initialCreators={creators} />)
    expect(screen.getByRole('button', { name: '添加博主' })).toBeDisabled()
    expect(screen.getByText('已达到 10 位上限')).toBeInTheDocument()
  })
})
