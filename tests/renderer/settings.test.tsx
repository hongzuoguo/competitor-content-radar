import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
