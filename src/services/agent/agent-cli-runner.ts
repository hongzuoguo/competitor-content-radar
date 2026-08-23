import { spawn } from 'node:child_process'
import type { DetectedAgentCli } from './agent-cli-detector'
import type { AgentReasoningEffort } from '../../shared/ipc-contract'
import type { ConnectionTestResult } from '../ai/model-profile-service'

const CODEX_ISOLATION_ARGS = [
  '--ephemeral',
  '--ignore-user-config',
  '--ignore-rules',
  '--sandbox', 'read-only',
  '-c', 'project_doc_max_bytes=0',
  '--disable', 'apps',
  '--disable', 'plugins',
  '--disable', 'skill_search',
  '-c', 'shell_environment_policy.ignore_default_excludes=false'
] as const
const MAX_STDOUT_BYTES = 256 * 1024
const MAX_STDERR_BYTES = 16 * 1024
const CODEX_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'CODEX_HOME',
  'NO_PROXY'
] as const

export interface AgentCliRunnerOptions {
  /** Full command resolved for the detected Agent (absolute path). */
  resolveCommand(command: string): Promise<string>
  /** Get the running local Agent endpoint for this run's MCP configuration. */
  getEndpoint(): { port: number, token: string } | null
  /** Parent environment source for the restricted Codex child environment. */
  environment?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export interface AgentCliRunResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  errorCode?: string
}

export interface AgentCliRunTask {
  workId: string
  transcript: string
  /** Optional Codex model ID, forwarded through the CLI --model option. */
  model?: string
  /** Optional Codex reasoning effort, forwarded as a per-run config override. */
  reasoningEffort?: AgentReasoningEffort
}

/** Options for a free-form Agent run (used by the one-click rewrite). */
export interface AgentCliRewriteOptions {
  /** Codex model ID forwarded through the CLI --model option. */
  model?: string
  /** Codex reasoning effort forwarded as a per-run config override. */
  reasoningEffort?: AgentReasoningEffort
}

/**
 * Runs one seven-field analysis task through a headless Agent CLI. The Agent
 * reads the work transcript from the prompt, analyzes with its own model,
 * and writes the result back through the local Agent API. The runner only
 * starts the CLI and waits; it never reads Agent credentials.
 */
export class AgentCliRunner {
  constructor(private readonly options: AgentCliRunnerOptions) {}

  async run(agent: DetectedAgentCli, task: AgentCliRunTask): Promise<AgentCliRunResult> {
    const endpoint = this.options.getEndpoint()
    if (!endpoint) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', errorCode: 'AGENT_ENDPOINT_UNAVAILABLE' }
    }
    const command = await this.options.resolveCommand(agent.command)
    const prompt = buildTaskPrompt(task)
    return this.spawn(
      agent,
      command,
      prompt,
      task.model,
      task.reasoningEffort,
      buildHitMuseMcpArgs(endpoint.port),
      { HITMUSE_MCP_TOKEN: endpoint.token },
      endpoint.token
    )
  }

  /** Runs a free-form prompt through the Agent CLI and returns raw stdout.
   * Used by the one-click rewrite (JSON output) and other user-driven tasks
   * that don't need the MCP endpoint. */
  async runRewrite(agent: DetectedAgentCli, prompt: string, options?: AgentCliRewriteOptions): Promise<AgentCliRunResult> {
    const command = await this.options.resolveCommand(agent.command)
    return this.spawn(agent, command, prompt, options?.model, options?.reasoningEffort)
  }

  async testConnection(agent: DetectedAgentCli, options?: AgentCliRewriteOptions): Promise<ConnectionTestResult> {
    const reasoningEffort = options?.reasoningEffort
    const result = await this.runRewrite(agent, '只回答 OK', {
      model: options?.model?.trim() || undefined,
      reasoningEffort: reasoningEffort?.trim() ? reasoningEffort : undefined
    })
    if (result.ok && result.stdout.trim()) return { executed: true, ok: true }
    return classifyCodexHealthFailure(result)
  }

  private spawn(
    agent: DetectedAgentCli,
    command: string,
    prompt: string,
    model?: string,
    reasoningEffort?: AgentReasoningEffort,
    runArgs: readonly string[] = [],
    runEnv: NodeJS.ProcessEnv = {},
    redactionToken?: string
  ): Promise<AgentCliRunResult> {
    // resolveCommand (in production-runtime) walks any .cmd/.bat on Windows
    // and returns the real .exe inside, so by the time we get here the
    // command is always a directly-spawnable binary. Plain .cmd files
    // would need shell:true (Node throws EINVAL otherwise).
    const isWindows = process.platform === 'win32'
    const isScript = /\.(cmd|bat)$/i.test(command)
    const args = buildCodexArgs(agent, model, reasoningEffort, runArgs)
    return new Promise((resolve) => {
      const timeoutMs = this.options.timeoutMs ?? 5 * 60_000
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      const finish = (result: Omit<AgentCliRunResult, 'stdout' | 'stderr'>): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve({
          ...result,
          stdout: redactAgentOutput(stdout.toString('utf8'), redactionToken),
          stderr: redactAgentOutput(stderr.toString('utf8'), redactionToken)
        })
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(command, args, {
          windowsHide: true,
          shell: isWindows && isScript,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...selectCodexEnvironment(this.options.environment ?? process.env),
            CONTENT_RADAR_AGENT_TASK: '1',
            ...runEnv
          }
        })
      } catch (error) {
        stderr = appendTail(stderr, String(error), MAX_STDERR_BYTES)
        finish({
          ok: false, exitCode: null, errorCode: 'AGENT_CLI_FAILED'
        })
        return
      }
      timer = setTimeout(() => {
        finish({ ok: false, exitCode: null, errorCode: 'AGENT_CLI_TIMEOUT' })
        child.kill()
      }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendHead(stdout, chunk, MAX_STDOUT_BYTES)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendTail(stderr, chunk, MAX_STDERR_BYTES)
      })
      child.stdin?.on('error', () => {
        finish({ ok: false, exitCode: null, errorCode: 'AGENT_CLI_STDIN_FAILED' })
        child.kill()
      })
      child.on('error', (error: Error) => {
        const code = (error as NodeJS.ErrnoException).code
        stderr = appendTail(stderr, error.message, MAX_STDERR_BYTES)
        finish({
          ok: false,
          exitCode: null,
          errorCode: code === 'ENOENT' ? 'AGENT_CLI_NOT_FOUND' : 'AGENT_CLI_FAILED'
        })
      })
      child.on('close', (code) => {
        finish({
          ok: code === 0,
          exitCode: code,
          ...(code === 0 ? {} : { errorCode: classifyAgentFailure(`${stderr.toString('utf8')}\n${stdout.toString('utf8')}`) })
        })
      })
      try {
        child.stdin?.end(prompt, 'utf8')
      } catch {
        finish({ ok: false, exitCode: null, errorCode: 'AGENT_CLI_STDIN_FAILED' })
        child.kill()
      }
    })
  }
}

export function selectCodexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of CODEX_ENV_ALLOWLIST) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

function appendHead(current: Buffer, chunk: Buffer | string, maxBytes: number): Buffer {
  if (current.length >= maxBytes) return current
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
  const remaining = maxBytes - current.length
  return Buffer.concat([current, incoming.subarray(0, remaining)])
}

function appendTail(current: Buffer, chunk: Buffer | string, maxBytes: number): Buffer {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
  const combined = Buffer.concat([current, incoming])
  return combined.length <= maxBytes
    ? combined
    : Buffer.from(combined.subarray(combined.length - maxBytes))
}

function redactAgentOutput(value: string, token?: string): string {
  let result = token ? value.split(token).join('[REDACTED]') : value
  result = result
    .replace(/Authorization:\s*Bearer\s+(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/HITMUSE_MCP_TOKEN\s*=\s*[^\s"']+/gi, 'HITMUSE_MCP_TOKEN=[REDACTED]')
    .replace(/Bearer\s+(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, 'Bearer [REDACTED]')
    .replace(/(^|[{\s,?&])((?:"?(?:x[_-]?api[_-]?key|api[_-]?key|app[_-]?secret|(?:hitmuse[_-]?)?mcp[_-]?token|cookie)"?)\s*(?:=|:)\s*)("[^"]*"|'[^']*'|[^\s,&}"']+)/gim, (_match, boundary: string, field: string, secret: string) => {
      const redacted = secret.startsWith('"') ? '"[REDACTED]"' : secret.startsWith("'") ? "'[REDACTED]'" : '[REDACTED]'
      return `${boundary}${field}${redacted}`
    })
    .replace(/((?:Set-)?Cookie\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
  return result
}

function classifyAgentFailure(detail: string): string {
  const normalized = detail.toLowerCase()
  if (/mcp.{0,80}(?:failed|unavailable|initialize|connect|transport)|(?:failed|unavailable).{0,80}mcp/.test(normalized)) {
    return 'AGENT_MCP_UNAVAILABLE'
  }
  if (/login|required.*login|not logged in|authentication required/.test(normalized)) {
    return 'AGENT_CLI_LOGIN_REQUIRED'
  }
  if (/model.*(?:not found|unavailable)|unknown model/.test(normalized)) {
    return 'AGENT_MODEL_UNAVAILABLE'
  }
  if (/rate.?limit|too many requests|\b429\b/.test(normalized)) {
    return 'AGENT_CLI_RATE_LIMITED'
  }
  if (/permission denied|forbidden|unauthorized|\b40[13]\b/.test(normalized)) {
    return 'AGENT_CLI_PERMISSION_DENIED'
  }
  return 'AGENT_CLI_FAILED'
}

function buildHitMuseMcpArgs(port: number): string[] {
  return [
    '-c', `mcp_servers.hitmuse.url="http://127.0.0.1:${port}/mcp"`,
    '-c', 'mcp_servers.hitmuse.bearer_token_env_var="HITMUSE_MCP_TOKEN"',
    '-c', 'mcp_servers.hitmuse.required=true',
    '-c', 'mcp_servers.hitmuse.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.hitmuse.enabled_tools=["works.get","analysis.write"]'
  ]
}

function buildCodexArgs(
  agent: DetectedAgentCli,
  model?: string,
  reasoningEffort?: AgentReasoningEffort,
  runArgs: readonly string[] = []
): string[] {
  const baseArgs = agent.execArgs('-', model, reasoningEffort)
  const promptSourceIndex = baseArgs.lastIndexOf('-')
  const insertionIndex = promptSourceIndex >= 0 ? promptSourceIndex : Math.min(1, baseArgs.length)
  return [
    ...baseArgs.slice(0, insertionIndex),
    ...CODEX_ISOLATION_ARGS,
    ...runArgs,
    ...baseArgs.slice(insertionIndex)
  ]
}

function classifyCodexHealthFailure(result: AgentCliRunResult): ConnectionTestResult {
  const codeMap: Record<string, string> = {
    AGENT_CLI_NOT_FOUND: 'CODEX_CLI_NOT_FOUND',
    AGENT_CLI_LOGIN_REQUIRED: 'CODEX_LOGIN_REQUIRED',
    AGENT_MODEL_UNAVAILABLE: 'CODEX_MODEL_UNAVAILABLE',
    AGENT_CLI_RATE_LIMITED: 'CODEX_RATE_LIMITED',
    AGENT_CLI_PERMISSION_DENIED: 'CODEX_PERMISSION_DENIED',
    AGENT_CLI_TIMEOUT: 'CODEX_TIMEOUT'
  }
  if (result.errorCode && codeMap[result.errorCode]) {
    return { executed: true, ok: false, errorCode: codeMap[result.errorCode] }
  }

  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
  if (/login|required.*login|not logged in|authentication required/.test(detail)) {
    return { executed: true, ok: false, errorCode: 'CODEX_LOGIN_REQUIRED' }
  }
  if (/model.*(?:not found|unavailable)|unknown model/.test(detail)) {
    return { executed: true, ok: false, errorCode: 'CODEX_MODEL_UNAVAILABLE' }
  }
  if (/rate.?limit|too many requests|\b429\b/.test(detail)) {
    return { executed: true, ok: false, errorCode: 'CODEX_RATE_LIMITED' }
  }
  if (/permission denied|forbidden|unauthorized|\b40[13]\b/.test(detail)) {
    return { executed: true, ok: false, errorCode: 'CODEX_PERMISSION_DENIED' }
  }
  if (/timeout|timed out/.test(detail)) {
    return { executed: true, ok: false, errorCode: 'CODEX_TIMEOUT' }
  }
  return { executed: true, ok: false, errorCode: 'CODEX_CONNECTION_FAILED' }
}

export function buildTaskPrompt(task: AgentCliRunTask): string {
  return [
    '这是 HitMuse 的非编码自动化任务。不要读取代码仓库、AGENTS.md、规则文件或技能。',
    `1. 必须先调用 HitMuse MCP 工具 works.get，参数为 {"id":"${task.workId}"}，读取作品文字稿。`,
    '2. 对文字稿做结构化拆解。category 必须是 2-12 字的具体创作方向，不能只写 AI、内容、工具或教程；keywords 必须是 2-3 个完整中文主题词组，禁止把标题机械切成“进入、实用、设置、新手”等碎片。另需给出选题角度(topicAngle)、开头钩子(openingHook)、结构(structure 数组)、爆点(viralPoints 数组)、亮点(highlights 数组)、可复用模式(reusablePatterns 数组)、差异化建议(differentiatedSuggestions 对象,含 angles/titles/openings/risks 四个数组)。',
    `3. 必须调用 HitMuse MCP 工具 analysis.write 写回结果，参数包含 {"workId":"${task.workId}","category":"<具体创作方向>","keywords":["<完整主题词组>","<完整主题词组>"],"angle":"<角度>","hook":"<钩子>","structure":[...],"explosion":[...],"highlights":[...],"reusablePatterns":[...],"differentiatedSuggestions":{"angles":[...],"titles":[...],"openings":[...],"risks":[...]},"modelId":"${task.model ?? '<你的模型名>'}","schemaVersion":"v2"}。`,
    '不要使用 shell、PowerShell、curl 或自行拼装 HTTP 请求。请直接完成两次工具调用，不要询问、不要中途停止。'
  ].join('\n')
}
