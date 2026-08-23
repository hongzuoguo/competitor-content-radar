import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '../../src/renderer/src/components/Topbar'
import type { EngineHealthView } from '../../src/shared/ipc-contract'

describe('topbar run feedback', () => {
  afterEach(() => vi.restoreAllMocks())

  function installDesktopApi(
    runNow: () => Promise<{ accepted: boolean; reason?: string }>,
    health: EngineHealthView = engineHealth('unknown', 'unknown')
  ): ReturnType<typeof vi.fn> {
    const detectAgentCli = vi.fn().mockResolvedValue(null)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        runNow,
        getSettings: vi.fn().mockResolvedValue({ runEngine: 'cloud' }),
        saveSettings: vi.fn().mockResolvedValue({}),
        listModelProfiles: vi.fn().mockResolvedValue([]),
        detectAgentCli,
        peekEngineHealth: vi.fn().mockResolvedValue(health),
        getEngineHealth: vi.fn().mockResolvedValue(health),
        refreshEngineHealth: vi.fn().mockResolvedValue(health),
        getAgentStatus: vi.fn().mockResolvedValue({ enabled: false, running: false, port: null, address: null, apiVersion: 'v1', error: null }),
        getUpdateState: vi.fn().mockResolvedValue({ status: 'idle' }),
        onUpdateState: vi.fn().mockReturnValue(() => undefined)
      }
    })
    return detectAgentCli
  }

  it('does not show a next daily monitoring time', () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)

    expect(screen.queryByText(/下次运行|08:00/)).not.toBeInTheDocument()
  })

  it('does not show a hard-coded service-normal badge', () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)

    expect(screen.queryByText('服务正常')).not.toBeInTheDocument()
  })

  it('keeps the named run action on monochrome semantic primary tokens', () => {
    const globalCss = readFileSync('src/renderer/src/styles/global.css', 'utf8')
    const topbarCss = readFileSync('src/renderer/src/components/topbar.css', 'utf8')

    expect(globalCss).toMatch(/\.button--primary\s*\{[^}]*background:\s*var\(--color-primary\);[^}]*color:\s*var\(--color-on-primary\)/s)
    expect(globalCss).toMatch(/\.button--primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--color-primary-hover\)/s)
    expect(topbarCss).not.toContain('#16afc1')

    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))
    render(<Topbar />)
    expect(screen.getByRole('button', { name: '\u7acb\u5373\u8fd0\u884c' })).toBeInTheDocument()
  })

  it('reveals the shared shell material instead of painting a second topbar', () => {
    const topbarCss = readFileSync('src/renderer/src/components/topbar.css', 'utf8')

    expect(topbarCss).toMatch(/\.topbar\s*\{[^}]*background:\s*transparent/s)
    expect(topbarCss).toMatch(/\.topbar\s*\{[^}]*padding:\s*0 var\(--space-8\) 0 var\(--space-4\)/s)
    expect(topbarCss).not.toMatch(/\.topbar\s*\{[^}]*background-image:/s)
    expect(topbarCss).not.toMatch(/\.topbar::(?:before|after)\s*\{/)
  })

  it('opts only the approved toolbar, engine overlay, and run action into glass', async () => {
    const topbarSource = readFileSync('src/renderer/src/components/Topbar.tsx', 'utf8')
    const topbarCss = readFileSync('src/renderer/src/components/topbar.css', 'utf8')
    const menuGeometry = topbarCss.match(/\.engine-select__menu\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(topbarSource).toContain('className="topbar glass-toolbar"')
    expect(topbarSource).toContain('className="engine-select__menu glass-panel"')
    expect(topbarSource).toContain('className="topbar__primary-action glass-button"')
    expect(menuGeometry).toContain('border-width: 1px')
    expect(menuGeometry).toContain('border-style: solid')
    expect(menuGeometry).not.toContain('background:')
    expect(menuGeometry).not.toContain('box-shadow:')
    expect(topbarCss).toMatch(/\.engine-select__menu \.engine-select__item:hover,[\s\S]*?background:\s*rgb\(17 21 22 \/ 7%\)/s)
    expect(topbarCss).toMatch(/\.engine-select__menu \.engine-select__item\.is-selected\s*\{[^}]*background:\s*rgb\(17 21 22 \/ 12%\)/s)
    expect(topbarCss).toMatch(/\.engine-select__menu \.engine-select__item-text small\s*\{[^}]*color:\s*var\(--color-muted\)/s)

    const engineTrigger = topbarCss.match(/\.engine-select__trigger\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(engineTrigger).toContain('background: linear-gradient')
    expect(engineTrigger).toContain('var(--color-glass-light)')
    expect(engineTrigger).toContain('backdrop-filter: blur(var(--glass-blur))')
    expect(engineTrigger).toContain('box-shadow: inset 0 1px')
    expect(engineTrigger).not.toContain('background: var(--color-surface)')
    expect(topbarCss).toMatch(/\.engine-select__trigger\[aria-expanded='true'\]\s*\{[^}]*box-shadow:/s)

    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))
    render(<Topbar />)
    fireEvent.click(await screen.findByRole('button', { name: /云端模型/ }))

    const menu = screen.getByRole('group')
    expect(menu.querySelectorAll('button')).toHaveLength(2)
  })

  it('keeps the healthy engine status dot free of decorative halos', () => {
    const topbarCss = readFileSync('src/renderer/src/components/topbar.css', 'utf8')
    const healthyDot = topbarCss.match(/\.engine-status-dot\.is-healthy\s*\{([^}]*)\}/s)?.[1]

    expect(healthyDot).toContain('background: var(--color-success)')
    expect(healthyDot).not.toContain('box-shadow')
  })

  it('shows visible confirmation as soon as a run is accepted', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))

    expect(await screen.findByText('任务已启动，请到总览查看进度')).toBeVisible()
  })

  it('shows the rejection reason instead of failing silently', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: false, reason: '请先完成 AI 模型设置' }))

    render(<Topbar />)
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))

    expect(await screen.findByText('请先完成 AI 模型设置')).toBeVisible()
  })

  it('renders the engine selector with cloud and local Codex options', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)

    expect(await screen.findByText('云端模型')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /云端模型/ }))
    expect(screen.getByText('本地 Codex')).toBeInTheDocument()
  })

  it('uses native toggle semantics and restores trigger focus on Escape', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))
    render(<Topbar />)

    const trigger = await screen.findByRole('button', { name: /云端模型/ })
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /云端模型.*尚未验证/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '运行引擎' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores trigger focus after selecting an engine', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))
    render(<Topbar />)

    const trigger = await screen.findByRole('button', { name: /云端模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /本地 Codex.*尚未验证/ }))

    expect(trigger).toHaveFocus()
  })

  it('rereads persisted health on window focus without live refresh or polling', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval')
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }))

    render(<Topbar />)
    await waitFor(() => expect(window.desktopApi.peekEngineHealth).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(window.desktopApi.peekEngineHealth).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new Event('content-radar:engine-health-changed'))
    await waitFor(() => expect(window.desktopApi.peekEngineHealth).toHaveBeenCalledTimes(3))
    expect(window.desktopApi.getEngineHealth).not.toHaveBeenCalled()
    expect(window.desktopApi.refreshEngineHealth).not.toHaveBeenCalled()
    expect(window.desktopApi.detectAgentCli).not.toHaveBeenCalled()

    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5000)
  })

  it('does not show configured-but-untested cloud as healthy', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }), engineHealth('unknown', 'unknown'))

    render(<Topbar />)

    const dot = await screen.findByTestId('engine-status-cloud')
    expect(dot).toHaveAttribute('data-status', 'unknown')
    expect(dot).not.toHaveClass('is-ready')
  })

  it('shows a persisted healthy cloud result as healthy', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }), engineHealth('healthy', 'unknown'))

    render(<Topbar />)

    expect(await screen.findByTestId('engine-status-cloud')).toHaveAttribute('data-status', 'healthy')
  })

  it('does not show stale or failed health as healthy', async () => {
    installDesktopApi(vi.fn().mockResolvedValue({ accepted: true }), engineHealth('healthy', 'unhealthy'))
    render(<Topbar />)
    await screen.findByTestId('engine-status-cloud')

    window.desktopApi.peekEngineHealth = vi.fn().mockResolvedValue(engineHealth('unknown', 'unhealthy'))
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(screen.getByTestId('engine-status-cloud')).toHaveAttribute('data-status', 'unknown'))
    fireEvent.click(screen.getByRole('button', { name: /云端模型/ }))
    expect(screen.getByTestId('engine-status-local-agent')).toHaveAttribute('data-status', 'unhealthy')
  })
})

function engineHealth(cloud: EngineHealthView['cloud']['status'], codex: EngineHealthView['codex']['status']): EngineHealthView {
  const entry = (status: EngineHealthView['cloud']['status']) => ({
    status,
    checkedAt: status === 'healthy' || status === 'unhealthy' ? '2026-08-09T09:00:00.000Z' : null,
    fingerprint: 'current',
    code: status === 'unhealthy' ? 'ENGINE_CHECK_FAILED' : null,
    message: status === 'unhealthy' ? '检测失败' : null
  })
  return { cloud: entry(cloud), codex: entry(codex), checking: false }
}
