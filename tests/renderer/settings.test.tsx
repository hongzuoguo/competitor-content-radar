import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'

describe('application settings', () => {
  it('switches provider presets and edits the absolute likes rule', () => {
    render(<SettingsPage />)
    fireEvent.change(screen.getByLabelText('AI 提供商'), { target: { value: 'kimi' } })
    expect(screen.getByLabelText('模型')).toHaveValue('kimi-k2.6')
    fireEvent.change(screen.getByLabelText('绝对高点赞阈值'), { target: { value: '12000' } })
    expect(screen.getByLabelText('绝对高点赞阈值')).toHaveValue(12000)
  })

  it('keeps the internal transcription engine out of normal settings', () => {
    render(<SettingsPage />)
    expect(screen.queryByText(/SenseVoice|FFmpeg/i)).not.toBeInTheDocument()
  })

  it('shows daily monitoring as a fixed 08:00 setting', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({ dailyTime: '09:00' }) }
    })

    render(<SettingsPage />)

    const input = await vi.waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('#daily-time')
      expect(element).not.toBeNull()
      return element!
    })
    expect(input).toHaveValue('08:00')
    expect(input).toBeDisabled()
  })

  it('shows secure Get Biji source fields without exposing a saved API key', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({
        contentSource: 'get_biji', getBijiTopicId: 'Y2m4oeAn', getBijiClientId: 'cli_saved', getBijiApiKeyConfigured: true
      }) }
    })

    render(<SettingsPage />)

    expect(await screen.findByLabelText('采集方式')).toHaveValue('get_biji')
    expect(screen.getByLabelText('知识库专题 ID')).toHaveValue('Y2m4oeAn')
    expect(screen.getByLabelText('Client ID')).toHaveValue('cli_saved')
    expect(screen.getByLabelText('得到大脑 API Key')).toHaveValue('')
    expect(screen.getByPlaceholderText('已安全保存；不修改可留空')).toBeInTheDocument()
  })
})
