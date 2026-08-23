import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSettings } from '../../src/renderer/src/features/settings/AgentSettings'

describe('Codex 拆解模型设置', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function installDesktopApi(): void {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        saveSettings: vi.fn().mockResolvedValue({}),
        detectAgentCli: vi.fn().mockResolvedValue(null),
        getAgentStatus: vi.fn().mockResolvedValue({
          enabled: true, running: true, port: 43100, address: 'http://127.0.0.1:43100',
          apiVersion: 'v1', error: null
        })
      }
    })
  }

  it('只展示 Codex 专用设置，不再展示通用 Agent 配置复制入口', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)

    expect(await screen.findByRole('heading', { name: '本地 Codex' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /复制给 Agent/ })).not.toBeInTheDocument()
  })

  it('输入框会保存到应用设置', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)
    const modelInput = await screen.findByLabelText('Codex 模型（可选）')
    fireEvent.change(modelInput, { target: { value: 'claude-sonnet-5' } })
    await waitFor(() => {
      expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentModel: 'claude-sonnet-5' })
    })
  })

  it('明确说明模型填写格式并把实际可用性检测留给统一状态刷新', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)

    expect(await screen.findByText('填写 Codex 模型 ID，例如 gpt-5.6-luna；留空则使用 Codex 当前默认模型。')).toBeVisible()
    expect(screen.getByText('推理强度不写在模型 ID 中。')).toBeVisible()
    expect(screen.queryByRole('button', { name: /检测 Codex 是否可用/ })).not.toBeInTheDocument()
    expect(screen.getByText('可执行诊断会在统一刷新状态时一起验证。')).toBeVisible()
  })

  it('把推理强度作为独立选项保存', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)

    const effort = await screen.findByRole('combobox', { name: '推理强度（可选）' })
    expect(effort).toHaveValue('')
    expect(screen.getByRole('option', { name: '使用 Codex 默认设置' })).toHaveValue('')
    expect(screen.getByRole('option', { name: '低' })).toHaveValue('low')
    expect(screen.getByRole('option', { name: '中' })).toHaveValue('medium')
    expect(screen.getByRole('option', { name: '高' })).toHaveValue('high')
    expect(screen.getByRole('option', { name: '极高' })).toHaveValue('xhigh')
    expect(screen.getByRole('option', { name: '最大' })).toHaveValue('max')

    fireEvent.change(effort, { target: { value: 'max' } })
    await waitFor(() => {
      expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentReasoningEffort: 'max' })
    })
  })

  it('模型 ID 原样保存并交给 Codex', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)
    const modelInput = await screen.findByLabelText('Codex 模型（可选）')
    fireEvent.change(modelInput, { target: { value: 'my-provider/model-v3' } })
    await waitFor(() => {
      expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentModel: 'my-provider/model-v3' })
    })
  })

  it('清空模型时删除手动覆盖而不保存空字符串', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)
    const modelInput = await screen.findByLabelText('Codex 模型（可选）')
    fireEvent.change(modelInput, { target: { value: 'temporary-model' } })
    await waitFor(() => expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentModel: 'temporary-model' }))
    fireEvent.change(modelInput, { target: { value: '' } })

    await waitFor(() => {
      expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentModel: undefined })
    })
  })

  it('识别不了的模型名原样保存', async () => {
    installDesktopApi()
    render(<AgentSettings supported />)
    const modelInput = await screen.findByLabelText('Codex 模型（可选）')
    fireEvent.change(modelInput, { target: { value: 'my-custom-v3' } })
    await waitFor(() => {
      expect(window.desktopApi.saveSettings).toHaveBeenCalledWith({ agentModel: 'my-custom-v3' })
    })
  })

})
