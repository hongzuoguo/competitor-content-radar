import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock }
}))

import { AgentCliRunner } from '../../src/services/agent/agent-cli-runner'
import type { DetectedAgentCli } from '../../src/services/agent/agent-cli-detector'

const codex: DetectedAgentCli = {
  id: 'codex',
  command: 'codex',
  displayName: 'Codex',
  execArgs: (prompt) => ['exec', prompt]
}

function makeMockChild(): ReturnType<typeof import('node:child_process').spawn> {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child as unknown as ReturnType<typeof import('node:child_process').spawn>
}

describe('AgentCliRunner process settlement', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    spawnMock.mockReset()
  })

  it('keeps the timeout result when kill synchronously emits close and settles only once', async () => {
    vi.useFakeTimers()
    const child = makeMockChild()
    child.kill = vi.fn(() => {
      child.emit('close', 0)
      return true
    })
    spawnMock.mockReturnValue(child)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'codex',
      getEndpoint: () => null,
      timeoutMs: 10
    })

    const result = runner.runRewrite(codex, 'health')
    await vi.advanceTimersByTimeAsync(10)

    await expect(result).resolves.toMatchObject({ ok: false, errorCode: 'AGENT_CLI_TIMEOUT' })
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('uses isolated Codex arguments and closes UTF-8 stdin exactly once', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const prompt = '请只返回 OK'
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'codex',
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    const result = runner.runRewrite(codex, prompt, {
      model: 'gpt-5.6-terra', reasoningEffort: 'high'
    })
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))

    const [, args, options] = spawnMock.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining([
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only',
      '-c', 'project_doc_max_bytes=0',
      '--disable', 'apps', '--disable', 'plugins', '--disable', 'skill_search',
      '-c', 'shell_environment_policy.ignore_default_excludes=false',
      '-'
    ]))
    expect(args.join(' ')).not.toContain(prompt)
    expect(options).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'] })
    expect(child.stdin.end).toHaveBeenCalledWith(prompt, 'utf8')
    expect(child.stdin.end).toHaveBeenCalledTimes(1)

    child.emit('close', 0)
    await expect(result).resolves.toMatchObject({ ok: true })
  })

  it('reports a synchronous stdin failure and ignores a later close event', async () => {
    const child = makeMockChild()
    child.stdin.end = vi.fn(() => { throw new Error('broken stdin') })
    spawnMock.mockReturnValue(child)
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'codex',
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    const result = runner.runRewrite(codex, 'health')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.emit('close', 0)

    await expect(result).resolves.toMatchObject({
      ok: false,
      errorCode: 'AGENT_CLI_STDIN_FAILED'
    })
    expect(child.stdin.end).toHaveBeenCalledTimes(1)
  })

  it('does not inject HitMuse MCP or its token into a health probe', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'codex',
      getEndpoint: () => ({ port: 43100, token: 'health-secret' }),
      timeoutMs: 10_000
    })

    const result = runner.testConnection(codex)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    const [, args, options] = spawnMock.mock.calls[0]
    expect(JSON.stringify(args)).not.toContain('mcp_servers.hitmuse')
    expect(options.env.HITMUSE_MCP_TOKEN).toBeUndefined()
    expect(JSON.stringify(options)).not.toContain('health-secret')

    child.stdout.emit('data', Buffer.from('OK'))
    child.emit('close', 0)
    await expect(result).resolves.toEqual({ executed: true, ok: true })
  })

  it('ignores close after an error and clears the timer only once', async () => {
    const child = makeMockChild()
    spawnMock.mockReturnValue(child)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'codex',
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    const result = runner.runRewrite(codex, 'health')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }))
    child.emit('close', 0)

    await expect(result).resolves.toMatchObject({ ok: false, errorCode: 'AGENT_CLI_NOT_FOUND' })
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })
})
