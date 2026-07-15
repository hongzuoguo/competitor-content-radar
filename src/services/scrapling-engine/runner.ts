import { spawn } from 'node:child_process'
import { z } from 'zod'
import { SCRAPLING_ENGINE_PROTOCOL_VERSION } from './manifest'

const workSchema = z.object({
  id: z.string().regex(/^\d+$/),
  title: z.string().min(1).max(10_000),
  publishedAt: z.string().datetime(),
  originalUrl: z.string().url(),
  downloadUrl: z.string().url().nullable(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  collects: z.number().int().nonnegative()
}).strict()

const successSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(true),
  creator: z.object({ name: z.string().min(1), profileUrl: z.string().url() }).strict(),
  works: z.array(workSchema).max(200)
}).strict()

const failureSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(false),
  error: z.object({
    code: z.string().regex(/^[A-Z0-9_]+$/),
    message: z.string().max(500)
  }).strict()
}).strict()

export type ScraplingCaptureResult = z.infer<typeof successSchema>

export interface ScraplingCaptureRequest {
  command: 'capture_creator'
  creatorId: string
  profileUrl: string
  profileDirectory: string
}

interface RunnerDependencies {
  invoke(executablePath: string, input: string, timeoutMs: number): Promise<string>
}

export class ScraplingEngineRunner {
  constructor(private readonly dependencies: RunnerDependencies = { invoke: invokeEngine }) {}

  async health(executablePath: string): Promise<void> {
    const output = await this.dependencies.invoke(executablePath, JSON.stringify({
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      command: 'health'
    }), 30_000)
    const parsed = parseJson(output)
    const result = z.object({
      protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
      ok: z.literal(true),
      status: z.literal('ready')
    }).strict().safeParse(parsed)
    if (!result.success) throw runnerError('SCRAPLING_ENGINE_HEALTH_FAILED')
  }

  async captureCreator(
    executablePath: string,
    request: ScraplingCaptureRequest
  ): Promise<ScraplingCaptureResult> {
    const output = await this.dependencies.invoke(executablePath, JSON.stringify({
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      ...request
    }), 120_000)
    const parsed = parseJson(output)
    if (typeof parsed === 'object' && parsed !== null && 'protocolVersion' in parsed
      && parsed.protocolVersion !== SCRAPLING_ENGINE_PROTOCOL_VERSION) {
      throw runnerError('SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED', false)
    }
    const failure = failureSchema.safeParse(parsed)
    if (failure.success) {
      const nonRetryable = ['DOUYIN_RISK_CONTROL', 'DOUYIN_BROWSER_NOT_FOUND'].includes(failure.data.error.code)
      throw Object.assign(new Error(failure.data.error.message), {
        code: failure.data.error.code,
        retryable: !nonRetryable
      })
    }
    const success = successSchema.safeParse(parsed)
    if (!success.success) throw runnerError('SCRAPLING_ENGINE_RESPONSE_INVALID')
    return success.data
  }
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output.trim()) as unknown
  } catch {
    throw runnerError('SCRAPLING_ENGINE_RESPONSE_INVALID')
  }
}

function invokeEngine(executablePath: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(runnerError('SCRAPLING_ENGINE_TIMEOUT')))
    }, timeoutMs)
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.resume()
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 10_000_000) {
        child.kill()
        finish(() => reject(runnerError('SCRAPLING_ENGINE_OUTPUT_TOO_LARGE')))
      }
    })
    child.once('error', () => finish(() => reject(runnerError('SCRAPLING_ENGINE_START_FAILED'))))
    child.once('exit', (code) => {
      if (code === 0) finish(() => resolve(stdout))
      else finish(() => reject(runnerError('SCRAPLING_ENGINE_EXITED')))
    })
    child.stdin.end(`${input}\n`, 'utf8')
  })
}

function runnerError(code: string, retryable = true): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(code), { code, retryable })
}
