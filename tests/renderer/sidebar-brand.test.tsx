import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../../src/renderer/src/components/Sidebar'

describe('HitMuse sidebar brand', () => {
  it('shows the HitMuse wordmark and changelog navigation when expanded', () => {
    render(<MemoryRouter><Sidebar collapsed={false} onToggle={vi.fn()} /></MemoryRouter>)

    expect(screen.getByRole('img', { name: 'HitMuse' })).toHaveAttribute('src', './hitmuse-logo.png')
    expect(screen.getByRole('link', { name: '更新日志' })).toHaveAttribute('href', '/changelog')
    expect(screen.queryByText('对标内容雷达')).not.toBeInTheDocument()
  })

  it('keeps a compact branded mark when collapsed', () => {
    render(<MemoryRouter><Sidebar collapsed onToggle={vi.fn()} /></MemoryRouter>)

    expect(screen.getByRole('img', { name: 'HitMuse' })).toHaveClass('brand__logo--collapsed')
    expect(screen.getByRole('img', { name: 'HitMuse' })).toHaveAttribute('src', './hitmuse-mark.png')
  })

  it('uses one transparent brand zone and a restrained glass active state', () => {
    const sidebarCss = readFileSync('src/renderer/src/components/sidebar.css', 'utf8')

    expect(sidebarCss).toMatch(/\.brand\s*\{[^}]*background:\s*transparent/s)
    expect(sidebarCss).toMatch(/\.brand\s*\{[^}]*justify-content:\s*center/s)
    expect(sidebarCss).toMatch(/\.nav__item--active\s*\{[^}]*border:\s*1px solid var\(--color-glass-border\)/s)
    expect(sidebarCss).toMatch(/\.nav__item--active\s*\{[^}]*background:\s*var\(--color-glass-dark\)/s)
    expect(sidebarCss).toMatch(/\.nav__item--active\s*\{[^}]*color:\s*var\(--color-sidebar-ink\)/s)
    const logoRule = sidebarCss.match(/\.brand__logo\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(logoRule).not.toContain('filter')
    expect(logoRule).toContain('width: 200px')
    expect(logoRule).toContain('height: 60px')
    expect(logoRule).toContain('object-position: center')
    expect(sidebarCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.brand\s*\{[^}]*justify-content:\s*center/s)
    render(<MemoryRouter><Sidebar collapsed={false} onToggle={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '\u603b\u89c8' })).toHaveAttribute('aria-current', 'page')
  })

  it('provides tooltips for every navigation destination', () => {
    render(<MemoryRouter><Sidebar collapsed={false} onToggle={vi.fn()} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '总览' })).toHaveAttribute('title', '总览')
  })
})
