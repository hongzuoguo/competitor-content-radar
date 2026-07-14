import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatorsPage } from '../../src/renderer/src/pages/CreatorsPage'

describe('creator management', () => {
  afterEach(() => {
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: undefined })
  })

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

  it('explains that the first capture starts in the background after adding', async () => {
    const addCreator = vi.fn().mockResolvedValue({
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting'
    })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { addCreator }
    })
    render(<CreatorsPage initialCreators={[]} />)
    fireEvent.change(screen.getByLabelText('抖音博主主页'), {
      target: { value: 'https://www.douyin.com/user/test' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加博主' }))

    expect(await screen.findByText('博主已添加，正在后台进行首次采集。')).toBeInTheDocument()
    expect(addCreator).toHaveBeenCalledWith('https://www.douyin.com/user/test')
  })

  it('does not duplicate an existing creator returned by the desktop runtime', async () => {
    const creator = {
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting' as const
    }
    const addCreator = vi.fn().mockResolvedValue(creator)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { addCreator }
    })
    render(<CreatorsPage initialCreators={[creator]} />)
    fireEvent.change(screen.getByLabelText('抖音博主主页'), {
      target: { value: 'https://v.douyin.com/same-card/' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加博主' }))

    await waitFor(() => expect(addCreator).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getAllByText('测试博主')).toHaveLength(1))
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

  it('keeps the confirmation open when desktop deletion fails', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { deleteCreator: vi.fn().mockRejectedValue(new Error('delete failed')) }
    })
    render(<CreatorsPage initialCreators={[{
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting'
    }]} />)

    fireEvent.click(screen.getByRole('button', { name: '删除测试博主' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('删除失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '删除测试博主？' })).toBeInTheDocument()
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
