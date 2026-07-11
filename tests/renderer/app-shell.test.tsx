import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../../src/renderer/src/components/AppShell'

describe('application shell', () => {
  it('provides named navigation and a main-content skip target', () => {
    render(
      <MemoryRouter>
        <AppShell><p>页面内容</p></AppShell>
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('navigation', { name: '主要导航' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /总览/ })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })

  it('collapses navigation without hiding accessible labels', () => {
    render(
      <MemoryRouter>
        <AppShell><p>页面内容</p></AppShell>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /博主管理/ })).toBeInTheDocument()
  })
})
