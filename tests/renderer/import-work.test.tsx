import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'

const desktopApi = {
  listCreators: vi.fn(),
  pickLocalVideo: vi.fn(),
  startImport: vi.fn()
} as unknown as DesktopApi

describe('work import dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopApi.listCreators = vi.fn().mockResolvedValue([
      { id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test', enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting' }
    ])
    desktopApi.pickLocalVideo = vi.fn().mockResolvedValue('C:\\video\\样片.mp4')
    desktopApi.startImport = vi.fn().mockResolvedValue({ accepted: true, workId: 'work-1' })
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: desktopApi })
  })

  it('opens and closes the dialog', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    expect(await screen.findByRole('dialog', { name: '导入作品' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '导入作品' })).not.toBeInTheDocument()
  })

  it('imports a local video with an optional creator', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    expect(await screen.findByText('样片.mp4')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('关联博主（可选）'), { target: { value: 'creator-1' } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(desktopApi.startImport).toHaveBeenCalledWith({
      source: { type: 'local', path: 'C:\\video\\样片.mp4' }, creatorId: 'creator-1'
    }))
    expect(await screen.findByText('任务已启动，请到作品分析查看进度')).toBeInTheDocument()
  })

  it('passes an existing work id to the parent for duplicate handling', async () => {
    const onImportAccepted = vi.fn()
    desktopApi.startImport = vi.fn().mockResolvedValue({ accepted: true, workId: 'pending-1', existingWorkId: 'work-existing' })
    render(<WorksPage onImportAccepted={onImportAccepted} />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(onImportAccepted).toHaveBeenCalledWith(expect.objectContaining({ existingWorkId: 'work-existing' })))
  })

  it('keeps creator selection when switching source tabs', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    const creator = await screen.findByLabelText('关联博主（可选）')
    fireEvent.change(creator, { target: { value: 'creator-1' } })
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    fireEvent.click(screen.getByRole('button', { name: '本地视频' }))
    expect(screen.getByLabelText('关联博主（可选）')).toHaveValue('creator-1')
  })

  it('does nothing when file selection is cancelled', async () => {
    desktopApi.pickLocalVideo = vi.fn().mockResolvedValue(null)
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument()
    expect(desktopApi.startImport).not.toHaveBeenCalled()
  })

  it('validates a single Douyin video URL before submit', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    fireEvent.change(screen.getByLabelText('抖音单条视频链接'), { target: { value: 'https://www.douyin.com/user/test' } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect(await screen.findByText('请输入抖音单条视频链接，不支持博主主页。')).toBeInTheDocument()
    expect(desktopApi.startImport).not.toHaveBeenCalled()
  })

  it('prevents duplicate submission while an import is starting', async () => {
    desktopApi.pickLocalVideo = vi.fn().mockResolvedValue('C:\\video\\样片.mp4')
    desktopApi.startImport = vi.fn().mockReturnValue(new Promise(() => undefined))
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    const submit = await screen.findByRole('button', { name: '正在启动…' })
    fireEvent.click(submit)
    expect(submit).toBeDisabled()
    expect(desktopApi.startImport).toHaveBeenCalledTimes(1)
  })

  it('offers local upload when a Douyin URL is unavailable', async () => {
    desktopApi.startImport = vi.fn().mockRejectedValue(Object.assign(new Error('无法获取这个视频'), {
      code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE', action: 'upload_local'
    }))
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    fireEvent.change(screen.getByLabelText('抖音单条视频链接'), { target: { value: 'https://www.douyin.com/video/7658288075461725474' } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    const fallback = await screen.findByRole('button', { name: '改为上传本地视频' })
    fireEvent.click(fallback)
    await waitFor(() => expect(desktopApi.pickLocalVideo).toHaveBeenCalled())
    expect(screen.getByLabelText('关联博主（可选）')).toBeInTheDocument()
  })
})
