import { describe, expect, it, vi } from 'vitest'
import { ScraplingDouyinSession } from '../../src/services/scrapling-engine/douyin-session'

const captureResult = {
  protocolVersion: 1 as const,
  ok: true as const,
  creator: { name: 'Creator', profileUrl: 'https://www.douyin.com/user/example' },
  works: [{
    id: '7659', title: 'Work', publishedAt: '2026-07-15T00:00:00.000Z',
    originalUrl: 'https://www.douyin.com/video/7659', downloadUrl: 'https://video.example/test.mp4',
    likes: 393, comments: 25, shares: 60, collects: 329
  }]
}

const command = { file: 'C:\\engine.exe', args: [], cwd: 'C:\\engine' }

function setup() {
  return {
    manager: { ensureInstalled: vi.fn().mockResolvedValue(command) },
    runner: {
      captureCreator: vi.fn().mockResolvedValue(captureResult),
      captureVideo: vi.fn().mockResolvedValue(captureResult.works[0]),
      login: vi.fn().mockResolvedValue(undefined),
      loginStatus: vi.fn().mockResolvedValue({ loggedIn: true })
    }
  }
}

describe('ScraplingDouyinSession', () => {
  it('opens the dedicated browser directly when a login launcher is provided', async () => {
    const deps = setup()
    const launchLoginBrowser = vi.fn().mockResolvedValue(undefined)
    const session = new ScraplingDouyinSession(
      deps.manager,
      deps.runner,
      'C:\\profile',
      undefined,
      launchLoginBrowser
    )

    await session.login()

    expect(launchLoginBrowser).toHaveBeenCalledWith('C:\\profile')
    expect(deps.manager.ensureInstalled).not.toHaveBeenCalled()
    expect(deps.runner.login).not.toHaveBeenCalled()
  })

  it('uses one dedicated profile for capture, video parsing, and login', async () => {
    const deps = setup()
    const session = new ScraplingDouyinSession(deps.manager, deps.runner, 'C:\\profile')

    const [creator, video, loggedIn] = await Promise.all([
      session.captureCreator('creator-1', 'https://www.douyin.com/user/example'),
      session.captureSingleVideo('7659', 'https://www.douyin.com/video/7659'),
      session.isLoggedIn()
    ])
    await session.login()

    expect(deps.runner.captureCreator).toHaveBeenCalledWith(command, {
      command: 'capture_creator', creatorId: 'creator-1', profileUrl: 'https://www.douyin.com/user/example', profileDirectory: 'C:\\profile'
    })
    expect(deps.runner.captureVideo).toHaveBeenCalledWith(command, 'C:\\profile', '7659')
    expect(deps.runner.loginStatus).toHaveBeenCalledWith(command, 'C:\\profile')
    expect(deps.runner.login).toHaveBeenCalledWith(command, 'C:\\profile')
    expect(creator.works[0]).toMatchObject({ id: 'douyin:7659', creatorId: 'creator-1' })
    expect(video).toEqual({ title: 'Work', downloadUrl: 'https://video.example/test.mp4' })
    expect(loggedIn).toBe(true)
  })

  it('releases the visible login browser before creator capture', async () => {
    const deps = setup()
    const prepareCapture = vi.fn().mockResolvedValue(undefined)
    const session = new ScraplingDouyinSession(
      deps.manager,
      deps.runner,
      'C:\\profile',
      undefined,
      undefined,
      prepareCapture
    )

    await session.captureCreator('creator-1', 'https://www.douyin.com/user/example')

    expect(prepareCapture).toHaveBeenCalledWith('C:\\profile')
    expect(prepareCapture.mock.invocationCallOrder[0]).toBeLessThan(deps.runner.captureCreator.mock.invocationCallOrder[0])
  })

  it('keeps the same profile through real login, browser close, and collection', async () => {
    const deps = setup()
    const events: string[] = []
    const launchLoginBrowser = vi.fn(async (profileDirectory: string) => {
      events.push(`login:${profileDirectory}`)
    })
    const prepareCapture = vi.fn(async (profileDirectory: string) => {
      events.push(`close:${profileDirectory}`)
    })
    deps.manager.ensureInstalled.mockImplementation(async () => {
      events.push('engine')
      return command
    })
    deps.runner.captureCreator.mockImplementation(async (_executablePath, request) => {
      events.push(`collect:${request.profileDirectory}`)
      return captureResult
    })
    const session = new ScraplingDouyinSession(
      deps.manager,
      deps.runner,
      'C:\\profile',
      undefined,
      launchLoginBrowser,
      prepareCapture
    )

    await session.login()
    await session.captureCreator('creator-1', 'https://www.douyin.com/user/example')

    expect(events).toEqual([
      'login:C:\\profile',
      'close:C:\\profile',
      'engine',
      'collect:C:\\profile'
    ])
  })

  it('marks works captured from my account as mine', async () => {
    const deps = setup()
    const session = new ScraplingDouyinSession(deps.manager, deps.runner, 'C:\\profile')

    const result = await session.captureCreator(
      'creator-mine',
      'https://www.douyin.com/user/mine',
      'mine'
    )

    expect(result.works).toHaveLength(1)
    expect(result.works[0].ownership).toBe('mine')
  })

  it('rejects mismatched single-video URLs before launching the engine', async () => {
    const deps = setup()
    const session = new ScraplingDouyinSession(deps.manager, deps.runner, 'C:\\profile')

    await expect(session.captureSingleVideo('7659', 'https://www.douyin.com/video/other')).rejects.toThrow('INVALID_DOUYIN_VIDEO_CAPTURE_REQUEST')
    expect(deps.manager.ensureInstalled).not.toHaveBeenCalled()
  })
})
