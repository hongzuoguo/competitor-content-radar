import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangelogPage, FEISHU_TUTORIAL_URL } from '../../src/renderer/src/pages/ChangelogPage'

describe('HitMuse changelog', () => {
  const openExternal = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    openExternal.mockClear()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { openExternal }
    })
  })

  it('explains the three 1.0.0 capabilities', () => {
    const { container } = render(<ChangelogPage />)

    expect(screen.getByRole('heading', { name: 'HitMuse 1.0.0' })).toBeInTheDocument()
    expect(container.querySelector('.changelog-version-surface')).toBeInTheDocument()
    expect(container.querySelectorAll('.changelog-content-surface')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '文案改写' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本地 Agent CLI 接入' })).toBeInTheDocument()
    expect(screen.getByText(/暂时支持 Codex/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '飞书多维表格接入' })).toBeInTheDocument()
    expect(screen.getByText(/近 7 天增速/)).toBeInTheDocument()
  })

  it('opens the Feishu connection tutorial', () => {
    render(<ChangelogPage />)
    fireEvent.click(screen.getByRole('button', { name: '查看飞书接入教程' }))
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(FEISHU_TUTORIAL_URL)
  })
})
