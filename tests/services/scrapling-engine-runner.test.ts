import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock }
}))

import {
  SCRAPLING_ENGINE_ERROR_CODES,
  summarizeScraplingEngineStderr,
  ScraplingEngineRunner
} from '../../src/services/scrapling-engine/runner'

const command = {
  file: 'C:\\engine.exe',
  args: ['-u', 'C:\\engine.py'],
  cwd: 'C:\\engine'
}

const protocolVectors = JSON.parse(readFileSync(
  join(process.cwd(), 'engine', 'scrapling', 'protocol-v1-vectors.json'), 'utf8'
)) as Array<{
  stdin: { protocolVersion: number, command: string, profileDirectory?: string | number }
  stdout: { error?: { code: string } } & Record<string, unknown>
}>

const protocolSchema = JSON.parse(readFileSync(
  join(process.cwd(), 'engine', 'scrapling', 'protocol-v1.schema.json'), 'utf8'
)) as { $defs: { errorResponse: { properties: { error: { properties: { code: { enum: string[] } } } } } } }

function protocolVector(commandName: string, errorCode?: string): typeof protocolVectors[number] {
  const vector = protocolVectors.find((candidate) => (
    candidate.stdin.command === commandName
    && (!errorCode || candidate.stdout.error?.code === errorCode)
  ))
  if (!vector) throw new Error(`Missing protocol vector: ${commandName}`)
  return vector
}

function makeMockChild(): ReturnType<typeof import('node:child_process').spawn> {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  child.kill = vi.fn(() => true)
  return child as unknown as ReturnType<typeof import('node:child_process').spawn>
}

const request = {
  command: 'capture_creator' as const,
  creatorId: 'creator-1',
  profileUrl: 'https://www.douyin.com/user/example',
  profileDirectory: 'C:\\Data\\browser'
}

describe('ScraplingEngineRunner', () => {
  afterEach(() => {
    spawnMock.mockReset()
    vi.restoreAllMocks()
  })

  it('uses the protocol error-code enum', () => {
    expect(SCRAPLING_ENGINE_ERROR_CODES).toEqual(protocolSchema.$defs.errorResponse.properties.error.properties.code.enum)
  })

  it('spawns an engine command without a shell', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))

    expect(spawnMock).toHaveBeenCalledWith(command.file, command.args, {
      cwd: command.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    expect(child.stdin.end).toHaveBeenCalledWith(`${JSON.stringify(protocolVector('health').stdin)}\n`, 'utf8')
    child.stdout.emit('data', JSON.stringify(protocolVector('health').stdout))
    child.emit('exit', 0)
    child.emit('close', 0)
    await expect(result).resolves.toBeUndefined()
  })

  it('drains stdout and stderr after exit before settling', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)
    let settled = false
    void result.then(() => { settled = true }, () => { settled = true })

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.emit('exit', 0)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)

    child.stdout.emit('data', JSON.stringify(protocolVector('health').stdout))
    child.stderr.emit('data', 'late warning')
    child.emit('close', 0)

    await expect(result).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Scrapling engine stderr', {
      code: 'SCRAPLING_ENGINE_STDERR', stderrBytes: Buffer.byteLength('late warning', 'utf8')
    })
  })

  it('uses the shared login-status protocol vector', async () => {
    const vector = protocolVector('login_status')
    const invoke = vi.fn().mockResolvedValue(JSON.stringify(vector.stdout))
    const runner = new ScraplingEngineRunner({ invoke })
    if (typeof vector.stdin.profileDirectory !== 'string') throw new Error('Missing profile directory')

    await expect(runner.loginStatus(command, vector.stdin.profileDirectory)).resolves.toEqual({ loggedIn: false })

    expect(JSON.parse(invoke.mock.calls[0][1])).toEqual(vector.stdin)
  })

  it.each([
    protocolVector('login', 'INVALID_PROFILE_DIRECTORY'),
    protocolVector('login_status', 'DOUYIN_BROWSER_NOT_FOUND')
  ])('preserves shared protocol failures', async (vector) => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify(vector.stdout))
    const runner = new ScraplingEngineRunner({ invoke })

    if (vector.stdin.command === 'login') {
      await expect(runner.login(command, vector.stdin.profileDirectory as unknown as string)).rejects.toMatchObject({
        code: vector.stdout.error?.code
      })
    } else {
      if (typeof vector.stdin.profileDirectory !== 'string') throw new Error('Missing profile directory')
      await expect(runner.loginStatus(command, vector.stdin.profileDirectory)).rejects.toMatchObject({
        code: vector.stdout.error?.code
      })
    }
    expect(JSON.parse(invoke.mock.calls[0][1])).toEqual(vector.stdin)
  })

  it('reports a nonzero engine exit', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.emit('exit', 1)
    child.emit('close', 1)

    await expect(result).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_EXITED' })
  })

  it('times out an engine command', async () => {
    vi.useFakeTimers()
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)
    const rejection = expect(result).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('reduces engine stderr to fixed transport metadata', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.stderr.emit('data', 'engine warning')
    child.stdout.emit('data', JSON.stringify(protocolVector('health').stdout))
    child.emit('exit', 0)
    child.emit('close', 0)

    await expect(result).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Scrapling engine stderr', {
      code: 'SCRAPLING_ENGINE_STDERR', stderrBytes: Buffer.byteLength('engine warning', 'utf8')
    })
  })

  it('rejects oversized engine output', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const result = new ScraplingEngineRunner().health(command)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'x'.repeat(10_000_001))

    await expect(result).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_OUTPUT_TOO_LARGE' })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('sends the protocol version and accepts a valid response', async () => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: true,
      creator: { name: '林克AI实战录', profileUrl: request.profileUrl },
      works: [{
        id: '7659', title: '作品', publishedAt: '2026-07-15T00:00:00.000Z',
        originalUrl: 'https://www.douyin.com/video/7659',
        downloadUrl: 'https://v26-web.douyinvod.com/video.mp4',
        likes: 393, comments: 25, shares: 60, collects: 329
      }],
      complete: false,
      missingWorkIds: ['7663141533167766803'],
      pagesCaptured: 2
    }))
    const runner = new ScraplingEngineRunner({ invoke })

    const result = await runner.captureCreator(command, request)
    expect(JSON.parse(invoke.mock.calls[0][1])).toMatchObject({ protocolVersion: 1, command: 'capture_creator' })
    expect(result.works[0]).toMatchObject({ id: '7659', likes: 393 })
    expect(result).toMatchObject({
      complete: false,
      missingWorkIds: ['7663141533167766803'],
      pagesCaptured: 2
    })
    expect(invoke).toHaveBeenCalledWith(command, expect.any(String), 210_000)
  })

  it('accepts a title with 10,000 astral code points', async () => {
    const title = '😀'.repeat(10_000)
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: true,
      creator: { name: 'Creator', profileUrl: request.profileUrl },
      works: [{
        id: '7659', title, publishedAt: '2026-07-15T00:00:00.000Z',
        originalUrl: 'https://www.douyin.com/video/7659', downloadUrl: null,
        likes: 0, comments: 0, shares: 0, collects: 0
      }]
    })) })

    await expect(runner.captureCreator(command, request)).resolves.toMatchObject({
      works: [{ title }]
    })
  })

  it('rejects a title with 10,001 astral code points', async () => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: true,
      creator: { name: 'Creator', profileUrl: request.profileUrl },
      works: [{
        id: '7659', title: '😀'.repeat(10_001), publishedAt: '2026-07-15T00:00:00.000Z',
        originalUrl: 'https://www.douyin.com/video/7659', downloadUrl: null,
        likes: 0, comments: 0, shares: 0, collects: 0
      }]
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_RESPONSE_INVALID'
    })
  })

  it('accepts diagnostic strings at their astral code-point limits', async () => {
    const astral = (limit: number) => '😀'.repeat(limit)
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: false,
      error: {
        code: 'SCRAPLING_ENGINE_INTERNAL',
        message: astral(500),
        diagnostic: {
          payloadCount: 0,
          responses: [{ urlPath: astral(300), httpStatus: null, bodyBytes: 0 }],
          payloads: [{
            statusCode: 0, statusMessage: astral(300), loginGuide: false, awemeCount: 0,
            keys: [astral(100)], valueType: astral(100)
          }],
          exceptionType: astral(100),
          errorMessage: astral(500)
        }
      }
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_INTERNAL'
    })
  })

  it.each([
    ['not-json', 'SCRAPLING_ENGINE_RESPONSE_INVALID'],
    [JSON.stringify({ protocolVersion: 2, ok: true, creator: {}, works: [] }), 'SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED'],
    [JSON.stringify({ protocolVersion: 1, ok: true, creator: {}, works: [{ id: '../bad' }] }), 'SCRAPLING_ENGINE_RESPONSE_INVALID']
  ])('rejects an invalid response', async (output, code) => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(output) })
    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({ code })
  })

  it('preserves a stable engine failure code', async () => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1, ok: false, error: { code: 'DOUYIN_RISK_CONTROL', message: '需要人工验证' }
    })) })
    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'DOUYIN_RISK_CONTROL', retryable: false
    })
  })

  it('rejects an unknown engine error code as an invalid response', async () => {
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1, ok: false, error: { code: 'DOUYIN_NEW_UNKNOWN_FAILURE', message: 'unknown' }
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_RESPONSE_INVALID'
    })
  })

  it('treats an expired Douyin login as non-retryable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1, ok: false,
      error: {
        code: 'DOUYIN_LOGIN_REQUIRED',
        message: 'DOUYIN_LOGIN_REQUIRED',
        diagnostic: {
          payloadCount: 1,
          responses: [{ urlPath: '/aweme/v1/web/aweme/post/', httpStatus: 200, bodyBytes: 128 }],
          payloads: [{ statusCode: 0, loginGuide: true, awemeCount: 0, keys: ['aweme_list', 'not_login_module', 'status_code'] }]
        }
      }
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'DOUYIN_LOGIN_REQUIRED', retryable: false
    })
    expect(warn).toHaveBeenCalledWith('Scrapling engine reported failure', expect.objectContaining({
      code: 'DOUYIN_LOGIN_REQUIRED'
    }))
    warn.mockRestore()
  })

  it('preserves bounded engine diagnostics on a failure for application logging', async () => {
    const diagnostic = {
      exceptionType: 'TargetClosedError',
      errorMessage: 'Browser context closed before the response arrived'
    }
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: false,
      error: { code: 'SCRAPLING_ENGINE_INTERNAL', message: 'SCRAPLING_ENGINE_INTERNAL', diagnostic }
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({
      code: 'SCRAPLING_ENGINE_INTERNAL',
      retryable: true,
      diagnostic
    })
  })

  it('never writes raw engine diagnostics to the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runner = new ScraplingEngineRunner({ invoke: vi.fn().mockResolvedValue(JSON.stringify({
      protocolVersion: 1,
      ok: false,
      error: {
        code: 'SCRAPLING_ENGINE_INTERNAL', message: 'SCRAPLING_ENGINE_INTERNAL',
        diagnostic: {
          exceptionType: 'TimeoutError', errorMessage: 'Bearer secret-token C:\\private\\stack',
          responses: [{ urlPath: '/private/user/path', httpStatus: 500, bodyBytes: 10 }]
        }
      }
    })) })

    await expect(runner.captureCreator(command, request)).rejects.toMatchObject({ code: 'SCRAPLING_ENGINE_INTERNAL' })
    expect(warn).toHaveBeenCalledWith('Scrapling engine reported failure', { code: 'SCRAPLING_ENGINE_INTERNAL' })
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-token|private|stack/)
    warn.mockRestore()
  })

  it('reduces arbitrary engine stderr to fixed metadata', () => {
    const stderr = 'C:\\private\\engine Cookie: secret-cookie api_key=secret-key <html>private page</html>'

    const summary = summarizeScraplingEngineStderr(stderr)

    expect(summary).toEqual({ code: 'SCRAPLING_ENGINE_STDERR', stderrBytes: Buffer.byteLength(stderr, 'utf8') })
    expect(JSON.stringify(summary)).not.toMatch(/private|cookie|api_key|secret|html/i)
    expect(summarizeScraplingEngineStderr('')).toBeNull()
  })

  it('uses the same profile for login status and single-video capture', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ protocolVersion: 1, ok: true, loggedIn: true }))
      .mockResolvedValueOnce(JSON.stringify({
        protocolVersion: 1,
        ok: true,
        work: {
          id: '7663141533167766803', title: 'single work', publishedAt: '2026-07-17T00:00:00.000Z',
          originalUrl: 'https://www.douyin.com/video/7663141533167766803',
          downloadUrl: 'https://video.example/video.mp4', likes: 1, comments: 2, shares: 3, collects: 4
        }
      }))
    const runner = new ScraplingEngineRunner({ invoke })

    await expect(runner.loginStatus(command, 'C:\\Data\\browser')).resolves.toEqual({ loggedIn: true })
    await expect(runner.captureVideo(command, 'C:\\Data\\browser', '7663141533167766803'))
      .resolves.toMatchObject({ id: '7663141533167766803' })
    expect(JSON.parse(invoke.mock.calls[0][1])).toMatchObject({ command: 'login_status', profileDirectory: 'C:\\Data\\browser' })
    expect(JSON.parse(invoke.mock.calls[1][1])).toMatchObject({ command: 'capture_video', videoId: '7663141533167766803' })
  })
})
