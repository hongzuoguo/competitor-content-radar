import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../../src/renderer/src/components/AppShell'

describe('application shell', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('opens and closes an accessible mobile navigation drawer', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })))
    render(
      <MemoryRouter>
        <AppShell><p>椤甸潰鍐呭</p></AppShell>
      </MemoryRouter>
    )

    const trigger = screen.getByRole('button', { name: '打开导航' })
    const sidebar = document.querySelector('aside')!
    const workspace = document.querySelector('.workspace')!
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(sidebar).toHaveAttribute('inert')
    expect(sidebar).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(workspace).toHaveAttribute('inert')
    expect(workspace).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: /总览/ })).toHaveFocus()

    const lastNavLink = screen.getByRole('link', { name: /更新日志/ })
    lastNavLink.focus()
    fireEvent.keyDown(lastNavLink, { key: 'Tab' })
    expect(trigger).toHaveFocus()
    fireEvent.keyDown(trigger, { key: 'Tab', shiftKey: true })
    expect(lastNavLink).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(sidebar).toHaveAttribute('inert')
    expect(workspace).not.toHaveAttribute('inert')
  })
  it('uses the shared spacing scale to align page headings with content actions', () => {
    const globalCss = readFileSync('src/renderer/src/styles/global.css', 'utf8')

    expect(globalCss).toMatch(/\.page-heading\s*\{[^}]*gap:\s*var\(--space-6\)/s)
    expect(globalCss).toMatch(/\.page-heading\s*\{[^}]*margin-bottom:\s*var\(--space-8\)/s)
    expect(globalCss).toMatch(/\.page\s*\{[^}]*padding:\s*var\(--space-8\) var\(--space-8\) var\(--space-10\)/s)
  })

  it('owns one continuous straight glass row above both shell columns', () => {
    const globalCss = readFileSync('src/renderer/src/styles/global.css', 'utf8')

    expect(globalCss).toMatch(/\.app-shell::before\s*\{[^}]*inset:\s*0 0 auto;[^}]*height:\s*64px/s)
    expect(globalCss).toMatch(/\.app-shell::before\s*\{[^}]*background:\s*var\(--color-glass-light\)/s)
    expect(globalCss).toMatch(/\.page-scroll\s*\{[^}]*background:\s*var\(--color-canvas\)/s)
    expect(globalCss).not.toMatch(/\.app-shell::after\s*\{/)
  })
})
