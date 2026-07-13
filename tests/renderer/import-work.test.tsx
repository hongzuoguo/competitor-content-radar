import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'

const desktopApi = {
  listCreators: vi.fn(),
  pickLocalVideo: vi.fn(),
  getPathForFile: vi.fn(),
  startImport: vi.fn()
} as unknown as DesktopApi

async function waitForCreators(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText('关联博主（可选）')).toBeEnabled())
}

describe('work import dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopApi.listCreators = vi.fn().mockResolvedValue([
      { id: 'creator-1', name: '测试博主', profileUrl: 'https://www.douyin.com/user/test', enabled: true, works: 0, lastRun: '尚未采集', status: 'waiting' }
    ])
    desktopApi.pickLocalVideo = vi.fn().mockResolvedValue('C:\\video\\样片.mp4')
    desktopApi.getPathForFile = vi.fn().mockReturnValue('C:\\video\\拖放样片.mp4')
    desktopApi.startImport = vi.fn().mockResolvedValue({ accepted: true, workId: 'work-1' })
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: desktopApi })
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    await waitForCreators()
    fireEvent.change(screen.getByLabelText('抖音单条视频链接'), { target: { value: 'https://www.douyin.com/user/test' } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect(await screen.findByText('请输入抖音单条视频链接，不支持博主主页。')).toBeInTheDocument()
    expect(desktopApi.startImport).not.toHaveBeenCalled()
  })

  it('accepts a work opened from a creator modal', async () => {
    const modalUrl = 'https://www.douyin.com/user/self?from_tab_name=main&modal_id=7659607768617307402'
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    await waitForCreators()
    fireEvent.change(screen.getByLabelText('抖音单条视频链接'), { target: { value: modalUrl } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(desktopApi.startImport).toHaveBeenCalledWith(expect.objectContaining({
      source: { type: 'douyin_url', url: modalUrl }
    })))
  })

  it.each([
    'https://www.douyin.com/user/test?vid=7658288075461725474',
    'https://www.douyin.com/user/test?modal_id=',
    'https://www.douyin.com/user/test?modal_id=abc',
    'https://www.douyin.com/user/test?modal_id=123&modal_id=456',
    'https://www.douyin.com/user/test?modal_id=123&modal_id=123',
    'https://www.douyin.com/user/test/extra?modal_id=123',
    'https://user:pass@www.douyin.com/user/test?modal_id=123',
    'https://www.douyin.com:444/user/test?modal_id=123',
    'https://foo.douyin.com/video/7658288075461725474',
    'https://v.douyin.com/',
    'https://v.douyin.com/a/b',
    'https://user:pass@www.douyin.com/video/7658288075461725474',
    'https://www.douyin.com:444/video/7658288075461725474'
  ])('rejects a URL the import service would reject: %s', async (url) => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    await waitForCreators()
    fireEvent.change(screen.getByLabelText('抖音单条视频链接'), { target: { value: url } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/抖音单条视频链接|有效的抖音链接/)
    expect(desktopApi.startImport).not.toHaveBeenCalled()
  })

  it('accepts a direct video URL and a valid short URL', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(screen.getByRole('button', { name: '抖音链接' }))
    await waitForCreators()
    const input = screen.getByLabelText('抖音单条视频链接')
    fireEvent.change(input, { target: { value: 'https://v.douyin.com/AbC12/' } })
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(desktopApi.startImport).toHaveBeenCalledWith(expect.objectContaining({
      source: { type: 'douyin_url', url: 'https://v.douyin.com/AbC12/' }
    })))
  })

  it('imports a supported video dropped from Electron', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    const file = new File(['video'], '拖放样片.mp4', { type: 'video/mp4' })
    fireEvent.drop(await screen.findByTestId('local-video-drop-zone'), { dataTransfer: { files: [file] } })
    expect(await screen.findByText('拖放样片.mp4')).toBeInTheDocument()
    expect(desktopApi.getPathForFile).toHaveBeenCalledWith(file)
  })

  it('rejects an unsupported dropped file and links the error description', async () => {
    desktopApi.getPathForFile = vi.fn().mockReturnValue('C:\\video\\notes.txt')
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    const dropZone = await screen.findByTestId('local-video-drop-zone')
    fireEvent.drop(dropZone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('暂不支持这个视频格式')
    expect(screen.getByRole('button', { name: '选择视频' })).toHaveAttribute('aria-describedby', alert.id)
  })

  it('shows an error when Electron cannot resolve a dropped file path', async () => {
    desktopApi.getPathForFile = vi.fn().mockReturnValue('')
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.drop(await screen.findByTestId('local-video-drop-zone'), {
      dataTransfer: { files: [new File(['video'], '样片.mp4', { type: 'video/mp4' })] }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取拖放的视频，请改用“选择视频”。')
  })

  it('blocks submit while the creator list is loading', async () => {
    desktopApi.listCreators = vi.fn().mockReturnValue(new Promise(() => undefined))
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    expect(await screen.findByText('正在加载博主列表…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
    expect(await screen.findByRole('button', { name: '开始分析' })).toBeDisabled()
  })

  it('shows creator loading failure, retries, or requires explicit unclassified confirmation', async () => {
    desktopApi.listCreators = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([])
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    expect(await screen.findByText('博主列表加载失败。你可以重试，或确认以未分类作品继续。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
    expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '确认以未分类作品继续' }))
    expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '重试加载博主' }))
    await waitFor(() => expect(desktopApi.listCreators).toHaveBeenCalledTimes(2))
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

  it.each([
    ['INVALID_CREATOR', '关联的博主已不存在，请重新选择。'],
    ['INVALID_IMPORT_INPUT', '导入信息不完整，请重新选择视频或检查链接。'],
    ['APP_SHUTTING_DOWN', '应用正在关闭，请重新打开应用后再导入。'],
    ['FILE_NOT_FOUND', '无法读取这个视频，请确认文件仍在原位置。'],
    ['MEDIA_COPY_FAILED', '视频复制失败，请检查磁盘空间后重试。']
  ])('shows a stable Chinese message for %s', async (code, message) => {
    desktopApi.startImport = vi.fn().mockRejectedValue(Object.assign(new Error('Internal English message'), { code }))
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择视频' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('Internal English message')).not.toBeInTheDocument()
  })

  it('closes with Escape and restores focus to the import button', async () => {
    let restoreFocus!: FrameRequestCallback
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      restoreFocus = callback
      return 1
    })
    render(<WorksPage />)
    const trigger = screen.getByRole('button', { name: '导入作品' })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '导入作品' })
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导入作品' })).not.toBeInTheDocument())
    expect(trigger).not.toHaveFocus()
    restoreFocus(0)
    expect(trigger).toHaveFocus()
  })

  it('switches source tabs with the keyboard', async () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入作品' }))
    const local = await screen.findByRole('button', { name: '本地视频' })
    local.focus()
    fireEvent.keyDown(local, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '抖音链接' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('抖音单条视频链接')).toBeInTheDocument()
  })
})
