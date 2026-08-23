import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatorsPage } from '../../src/renderer/src/pages/CreatorsPage'
import type { CreatorRow } from '../../src/renderer/src/features/creators/types'

describe('creator management', () => {
  afterEach(() => {
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: undefined })
  })

  it('orders page identity, creator controls, and monitoring table as distinct regions', () => {
    const creator: CreatorRow = {
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 3, lastRun: '今天 09:00', status: 'ready'
    }
    render(<CreatorsPage initialCreators={[creator]} />)

    const pageHeading = document.querySelector<HTMLElement>('.page-heading')!
    const toolbar = screen.getByRole('region', { name: '博主管理工具' })
    const table = screen.getByRole('table')
    const monitoring = table.closest('section')!

    expect(pageHeading.tagName).toBe('HEADER')
    expect(toolbar).not.toContainElement(pageHeading)
    expect(toolbar).toContainElement(screen.getByLabelText('抖音博主主页'))
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '添加博主' }))
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '采集我的作品' }))
    expect(pageHeading.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbar.compareDocumentPosition(monitoring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(monitoring).toHaveClass('creator-monitoring-surface')
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

  it('adds the signed-in user account as my works', async () => {
    const addMyAccount = vi.fn().mockResolvedValue({
      id: 'creator-mine', name: '我的账号', profileUrl: 'https://www.douyin.com/user/mine',
      enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting'
    })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { addMyAccount }
    })
    render(<CreatorsPage initialCreators={[]} />)
    fireEvent.change(screen.getByLabelText('抖音博主主页'), {
      target: { value: 'https://www.douyin.com/user/mine' }
    })
    fireEvent.click(screen.getByRole('button', { name: '采集我的作品' }))

    expect(await screen.findByText('我的账号已添加，作品会标记为“我的作品”，正在后台进行首次采集。')).toBeInTheDocument()
    expect(addMyAccount).toHaveBeenCalledWith('https://www.douyin.com/user/mine')
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

  it('labels every creator table value for its narrow-screen row', () => {
    render(<CreatorsPage initialCreators={[{
      id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test',
      enabled: true, works: 3, lastRun: '今天 09:00', status: 'ready'
    }]} />)

    expect([...document.querySelectorAll<HTMLTableCellElement>('.data-table tbody td')].map((cell) => cell.dataset.label)).toEqual([
      '博主', '监控状态', '基线作品', '最近采集', '操作'
    ])
  })

  it('stacks creator rows with their field labels on narrow screens', () => {
    const styles = readFileSync('src/renderer/src/pages/workspace-pages.css', 'utf8')

    expect(styles).toMatch(/@media \(max-width: 719px\)[\s\S]*\.data-table td::before[\s\S]*content: attr\(data-label\)/)
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
