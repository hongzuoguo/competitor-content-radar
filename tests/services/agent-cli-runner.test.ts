import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { AgentCliRunner, buildTaskPrompt } from '../../src/services/agent/agent-cli-runner'
import type { DetectedAgentCli } from '../../src/services/agent/agent-cli-detector'

const codex: DetectedAgentCli = {
  id: 'codex',
  command: 'codex',
  displayName: 'Codex',
  execArgs: (prompt) => ['exec', prompt]
}

function makeFakeCli(exitCode: number, stderr = '', stdout = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-agent-'))
  const script = join(dir, 'fake-cli.cjs')
  writeFileSync(script, [
    '#!/usr/bin/env node',
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    `process.exit(${exitCode});`
  ].join('\n'), 'utf8')
  chmodSync(script, 0o755)
  return script
}

function makeSlowFakeCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slow-fake-agent-'))
  const script = join(dir, 'fake-cli.cjs')
  writeFileSync(script, 'setTimeout(() => process.exit(0), 1000)', 'utf8')
  return script
}

function makeInspectingFakeCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inspect-fake-agent-'))
  const script = join(dir, 'fake-cli.cjs')
  writeFileSync(script, [
    '#!/usr/bin/env node',
    'const chunks = [];',
    "process.stdin.on('data', (chunk) => chunks.push(chunk));",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({",
    '  args: process.argv.slice(2),',
    "  prompt: Buffer.concat(chunks).toString('utf8'),",
    "  hasMcpToken: typeof process.env.HITMUSE_MCP_TOKEN === 'string',",
    "  privateSentinel: Object.hasOwn(process.env, 'PRIVATE_SENTINEL'),",
    "  openAiApiKey: Object.hasOwn(process.env, 'OPENAI_API_KEY'),",
    "  httpProxy: Object.hasOwn(process.env, 'HTTP_PROXY'),",
    "  httpsProxy: Object.hasOwn(process.env, 'HTTPS_PROXY'),",
    "  userProfile: Object.hasOwn(process.env, 'USERPROFILE'),",
    "  allowed: Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME', 'NO_PROXY'].map((key) => [key, Object.hasOwn(process.env, key)]))",
    '})));'
  ].join('\n'), 'utf8')
  chmodSync(script, 0o755)
  return script
}

describe('agent-cli-runner', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('builds a tool-only task prompt without endpoint or credentials', () => {
    const prompt = buildTaskPrompt(
      { workId: 'w1', transcript: '文字稿内容' }
    )
    expect(prompt).toContain('works.get')
    expect(prompt).toContain('analysis.write')
    expect(prompt).toContain('"w1"')
    expect(prompt).not.toMatch(/127\.0\.0\.1|Authorization|Bearer|token|\/api\/v1/i)
    expect(prompt).not.toContain('tok-abc')
    expect(prompt).toContain('不要使用 shell、PowerShell、curl 或自行拼装 HTTP 请求')
    expect(prompt).toContain('topicAngle')
    expect(prompt).toContain('viralPoints')
    expect(prompt).toContain('"category":"<具体创作方向>"')
    expect(prompt).toContain('完整中文主题词组')
  })

  it('injects the current MCP port per analysis run and keeps its token in the child environment only', async () => {
    const script = makeInspectingFakeCli()
    tempDirs.push(join(script, '..'))
    const endpoints = [
      { port: 43100, token: 'first-secret' },
      { port: 43101, token: 'second-secret' }
    ]
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => endpoints.shift() ?? null,
      timeoutMs: 10_000
    })
    const inspectingCodex = { ...codex, execArgs: () => [script, '-'] }

    const first = await runner.run(inspectingCodex, { workId: 'w1', transcript: 'first' })
    const second = await runner.run(inspectingCodex, { workId: 'w2', transcript: 'second' })
    const firstRun = JSON.parse(first.stdout) as { args: string[], prompt: string, hasMcpToken: boolean }
    const secondRun = JSON.parse(second.stdout) as { args: string[], prompt: string, hasMcpToken: boolean }

    expect(firstRun.args).toContain('mcp_servers.hitmuse.url="http://127.0.0.1:43100/mcp"')
    expect(secondRun.args).toContain('mcp_servers.hitmuse.url="http://127.0.0.1:43101/mcp"')
    expect(firstRun.args).toContain('mcp_servers.hitmuse.bearer_token_env_var="HITMUSE_MCP_TOKEN"')
    expect(firstRun.args).toContain('mcp_servers.hitmuse.required=true')
    expect(firstRun.args).toContain('mcp_servers.hitmuse.default_tools_approval_mode="approve"')
    expect(firstRun.args).toContain('mcp_servers.hitmuse.enabled_tools=["works.get","analysis.write"]')
    expect(firstRun.hasMcpToken).toBe(true)
    expect(secondRun.hasMcpToken).toBe(true)
    expect(JSON.stringify(firstRun.args)).not.toContain('first-secret')
    expect(firstRun.prompt).not.toMatch(/first-secret|127\.0\.0\.1|Authorization|Bearer|\/api\/v1/i)
  })

  it('does not inject HitMuse MCP or its token into rewrite runs', async () => {
    const script = makeInspectingFakeCli()
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: 'rewrite-secret' }),
      timeoutMs: 10_000
    })

    const result = await runner.runRewrite({ ...codex, execArgs: () => [script, '-'] }, 'rewrite prompt')
    const run = JSON.parse(result.stdout) as { args: string[], prompt: string, hasMcpToken: boolean }

    expect(run.prompt).toBe('rewrite prompt')
    expect(run.hasMcpToken).toBe(false)
    expect(JSON.stringify(run.args)).not.toContain('mcp_servers.hitmuse')
    expect(JSON.stringify(run)).not.toContain('rewrite-secret')
  })

  it('passes only the Codex environment allowlist to child runs', async () => {
    const script = makeInspectingFakeCli()
    tempDirs.push(join(script, '..'))
    const environment = {
      PATH: 'test-path',
      PATHEXT: '.EXE',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      USERPROFILE: 'C:\\Users\\test-user',
      APPDATA: 'C:\\Users\\test-user\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test-user\\AppData\\Local',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Tmp',
      CODEX_HOME: 'C:\\Users\\test-user\\.codex',
      NO_PROXY: '127.0.0.1,localhost',
      PRIVATE_SENTINEL: 'parent-only-secret',
      OPENAI_API_KEY: 'parent-openai-key',
      HTTP_PROXY: 'http://parent-proxy',
      HTTPS_PROXY: 'http://parent-proxy'
    }
    const parentKeys = [...Object.keys(environment), 'HITMUSE_MCP_TOKEN']
    const parentValues = new Map(parentKeys.map((key) => [key, process.env[key]]))
    Object.assign(process.env, environment, { HITMUSE_MCP_TOKEN: 'parent-mcp-token' })
    try {
      const runner = new AgentCliRunner({
        resolveCommand: async () => process.execPath,
        getEndpoint: () => ({ port: 43100, token: 'run-mcp-token' }),
        environment,
        timeoutMs: 10_000
      })
      const inspectingCodex = { ...codex, execArgs: () => [script, '-'] }

      const analysis = JSON.parse((await runner.run(inspectingCodex, { workId: 'w1', transcript: 'text' })).stdout) as {
        hasMcpToken: boolean
        privateSentinel: boolean
        openAiApiKey: boolean
        httpProxy: boolean
        httpsProxy: boolean
        userProfile: boolean
        allowed: Record<string, boolean>
      }
      const rewrite = JSON.parse((await runner.runRewrite(inspectingCodex, 'rewrite')).stdout) as typeof analysis

      expect(analysis.hasMcpToken).toBe(true)
      expect(rewrite.hasMcpToken).toBe(false)
      const expectedAllowed = Object.fromEntries(Object.keys(environment).slice(0, 11).map((key) => [key, true]))
      for (const run of [analysis, rewrite]) {
        expect(run.userProfile).toBe(true)
        expect(run.allowed).toEqual(expectedAllowed)
        expect(run.privateSentinel).toBe(false)
        expect(run.openAiApiKey).toBe(false)
        expect(run.httpProxy).toBe(false)
        expect(run.httpsProxy).toBe(false)
      }
    } finally {
      for (const key of parentKeys) {
        const value = parentValues.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('returns ok when the fake CLI exits zero', async () => {
    const script = makeFakeCli(0)
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath, // node
      getEndpoint: () => ({ port: 43100, token: 'tok' }),
      timeoutMs: 10_000
    })
    const result = await runner.run({ ...codex, execArgs: () => [script, 'ignored'] }, { workId: 'w1', transcript: 'x' })
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it('forwards the selected model and reasoning effort to Codex for analysis runs', async () => {
    const script = makeFakeCli(0)
    tempDirs.push(join(script, '..'))
    const execArgs = vi.fn((_prompt: string, _model?: string, _reasoningEffort?: string) => [script])
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: 'tok' }),
      timeoutMs: 10_000
    })

    await runner.run({ ...codex, execArgs }, {
      workId: 'w1', transcript: 'x', model: 'gpt-5.6-luna', reasoningEffort: 'max'
    })

    expect(execArgs).toHaveBeenCalledWith('-', 'gpt-5.6-luna', 'max')
  })

  it('forwards the selected model and reasoning effort to Codex for rewrite runs', async () => {
    const script = makeFakeCli(0)
    tempDirs.push(join(script, '..'))
    const execArgs = vi.fn((_prompt: string, _model?: string, _reasoningEffort?: string) => [script])
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: 'tok' }),
      timeoutMs: 10_000
    })

    await runner.runRewrite({ ...codex, execArgs }, '改写提示词', {
      model: 'gpt-5.6-luna', reasoningEffort: 'max'
    })

    expect(execArgs).toHaveBeenCalledWith('-', 'gpt-5.6-luna', 'max')
  })

  it('reports a non-zero exit as failure', async () => {
    const script = makeFakeCli(3, 'boom')
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: 'tok' }),
      timeoutMs: 10_000
    })
    const result = await runner.run({ ...codex, execArgs: () => [script] }, { workId: 'w1', transcript: 'x' })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(3)
  })

  it('bounds process output and redacts credentials from a failed analysis run', async () => {
    const secret = 'run-secret-value'
    const stdout = 'o'.repeat(300 * 1024)
    const stderr = [
      'e'.repeat(20 * 1024),
      `Authorization: Bearer exposed-header`,
      `HITMUSE_MCP_TOKEN=exposed-env`,
      `Bearer exposed-loose`,
      secret
    ].join('\n')
    const script = makeFakeCli(1, stderr, stdout)
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: secret }),
      timeoutMs: 10_000
    })

    const result = await runner.run({ ...codex, execArgs: () => [script, '-'] }, {
      workId: 'w1', transcript: 'x'
    })

    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(256 * 1024)
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.stderr).not.toMatch(/Authorization:\s*Bearer\s+(?!\[REDACTED\])|HITMUSE_MCP_TOKEN=(?!\[REDACTED\])|Bearer\s+(?!\[REDACTED\])/i)
  })

  it('redacts every credential-shaped field from failed process output', async () => {
    const bearer = `bearer-${randomUUID()}`
    const mcpToken = `mcp-${randomUUID()}`
    const apiKey = `api-${randomUUID()}`
    const appSecret = `app-${randomUUID()}`
    const cookie = `cookie-${randomUUID()}`
    const explicitToken = `explicit-${randomUUID()}`
    const numericApiKey = '123456'
    const stderr = [
      `Authorization: Bearer "${bearer}"`,
      `Bearer '${bearer}'`,
      `HITMUSE_MCP_TOKEN=${mcpToken}`,
      `api_key=${apiKey}`,
      `api-key: ${apiKey}`,
      `X-Api-Key: ${apiKey}`,
      `{"api_key":"${apiKey}"}`,
      `api_key=${numericApiKey}`,
      `app_secret=${appSecret}`,
      `appSecret: ${appSecret}`,
      `MCP_TOKEN=${mcpToken}`,
      `mcp-token: ${mcpToken}`,
      `mcpToken: ${mcpToken}`,
      `cookie=${cookie}`,
      `COOKIE=${cookie}`,
      `Cookie: session=${cookie}`,
      `Set-Cookie: session=${cookie}; Path=/`,
      `https://example.test/rewrite?api_key=${apiKey}&app_secret=${appSecret}&next=ok`,
      explicitToken
    ].join('\n')
    const script = makeFakeCli(1, stderr, `api_key=${apiKey} app_secret=${appSecret} Cookie: session=${cookie} ${explicitToken}`)
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => ({ port: 43100, token: explicitToken }),
      timeoutMs: 10_000
    })

    const result = await runner.run({ ...codex, execArgs: () => [script, '-'] }, {
      workId: 'w1', transcript: 'x'
    })

    for (const sentinel of [bearer, mcpToken, apiKey, appSecret, cookie, explicitToken, numericApiKey]) {
      expect(JSON.stringify(result)).not.toContain(sentinel)
    }
  })

  it('classifies non-zero Codex exits with stable runner error codes', async () => {
    const cases = [
      ['login required', 'AGENT_CLI_LOGIN_REQUIRED'],
      ['model not found', 'AGENT_MODEL_UNAVAILABLE'],
      ['rate limit exceeded', 'AGENT_CLI_RATE_LIMITED'],
      ['permission denied', 'AGENT_CLI_PERMISSION_DENIED'],
      ['required MCP server hitmuse failed to initialize', 'AGENT_MCP_UNAVAILABLE'],
      ['unrecognized failure', 'AGENT_CLI_FAILED']
    ] as const

    for (const [stderr, errorCode] of cases) {
      const script = makeFakeCli(1, stderr)
      tempDirs.push(join(script, '..'))
      const runner = new AgentCliRunner({
        resolveCommand: async () => process.execPath,
        getEndpoint: () => null,
        timeoutMs: 10_000
      })

      await expect(runner.runRewrite({ ...codex, execArgs: () => [script, '-'] }, 'prompt'))
        .resolves.toMatchObject({ ok: false, errorCode })
    }
  })

  it('reports AGENT_ENDPOINT_UNAVAILABLE when the local endpoint is down', async () => {
    const runner = new AgentCliRunner({
      resolveCommand: async () => 'whatever',
      getEndpoint: () => null,
      timeoutMs: 10_000
    })
    const result = await runner.run(codex, { workId: 'w1', transcript: 'x' })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('AGENT_ENDPOINT_UNAVAILABLE')
  })

  it('reports AGENT_CLI_NOT_FOUND when the command is missing', async () => {
    const runner = new AgentCliRunner({
      resolveCommand: async () => join(tmpdir(), 'definitely-missing-agent-xyz'),
      getEndpoint: () => ({ port: 43100, token: 'tok' }),
      timeoutMs: 10_000
    })
    const result = await runner.run(codex, { workId: 'w1', transcript: 'x' })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('AGENT_CLI_NOT_FOUND')
  })

  it('runs one minimal Codex health probe with only nonblank configured options', async () => {
    const script = makeFakeCli(0, '', 'Codex: OK')
    tempDirs.push(join(script, '..'))
    const execArgs = vi.fn((_prompt: string, _model?: string, _reasoningEffort?: string) => [script])
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    await expect(runner.testConnection({ ...codex, execArgs }, {
      model: '  ', reasoningEffort: undefined
    })).resolves.toEqual({ executed: true, ok: true })
    expect(execArgs).toHaveBeenCalledTimes(1)
    expect(execArgs).toHaveBeenCalledWith('-', undefined, undefined)
  })

  it('forwards nonblank model and reasoning settings to the Codex health probe', async () => {
    const script = makeFakeCli(0, '', 'OK')
    tempDirs.push(join(script, '..'))
    const execArgs = vi.fn((_prompt: string, _model?: string, _reasoningEffort?: string) => [script])
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    await expect(runner.testConnection({ ...codex, execArgs }, {
      model: 'gpt-5.6-terra', reasoningEffort: 'high'
    })).resolves.toEqual({ executed: true, ok: true })
    expect(execArgs).toHaveBeenCalledWith('-', 'gpt-5.6-terra', 'high')
  })

  it('rejects a zero-exit Codex health probe with empty output', async () => {
    const script = makeFakeCli(0)
    tempDirs.push(join(script, '..'))
    const runner = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    await expect(runner.testConnection({ ...codex, execArgs: () => [script] })).resolves.toMatchObject({
      executed: true, ok: false, errorCode: 'CODEX_CONNECTION_FAILED'
    })
  })

  it('classifies missing and timed-out Codex commands', async () => {
    const missing = new AgentCliRunner({
      resolveCommand: async () => join(tmpdir(), 'definitely-missing-codex-health'),
      getEndpoint: () => null,
      timeoutMs: 10_000
    })
    await expect(missing.testConnection(codex)).resolves.toMatchObject({
      executed: true, ok: false, errorCode: 'CODEX_CLI_NOT_FOUND'
    })

    const script = makeSlowFakeCli()
    tempDirs.push(join(script, '..'))
    const timedOut = new AgentCliRunner({
      resolveCommand: async () => process.execPath,
      getEndpoint: () => null,
      timeoutMs: 10
    })
    await expect(timedOut.testConnection({ ...codex, execArgs: () => [script] })).resolves.toMatchObject({
      executed: true, ok: false, errorCode: 'CODEX_TIMEOUT'
    })
  })

  it('classifies Codex health failures without returning process output', async () => {
    const cases = [
      ['login required', 'CODEX_LOGIN_REQUIRED'],
      ['model not found', 'CODEX_MODEL_UNAVAILABLE'],
      ['permission denied', 'CODEX_PERMISSION_DENIED'],
      ['rate limit exceeded', 'CODEX_RATE_LIMITED'],
      ['unrecognised failure details', 'CODEX_CONNECTION_FAILED']
    ] as const

    for (const [stderr, errorCode] of cases) {
      const script = makeFakeCli(1, stderr, 'sensitive stdout')
      tempDirs.push(join(script, '..'))
      const runner = new AgentCliRunner({
        resolveCommand: async () => process.execPath,
        getEndpoint: () => null,
        timeoutMs: 10_000
      })

      const result = await runner.testConnection({ ...codex, execArgs: () => [script] })
      expect(result).toMatchObject({ executed: true, ok: false, errorCode })
      expect(result).not.toHaveProperty('stdout')
      expect(result).not.toHaveProperty('stderr')
    }
  })

  it('classifies a synchronous spawn failure without leaving the probe pending', async () => {
    const runner = new AgentCliRunner({
      resolveCommand: async () => '',
      getEndpoint: () => null,
      timeoutMs: 10_000
    })

    await expect(runner.testConnection(codex)).resolves.toMatchObject({
      executed: true, ok: false, errorCode: 'CODEX_CONNECTION_FAILED'
    })
  })
})
