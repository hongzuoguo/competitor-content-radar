import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { EngineCommand } from './command'
import { SCRAPLING_ENGINE_PROTOCOL_VERSION } from './manifest'

export const SCRAPLING_ENGINE_ERROR_CODES = [
  'PROTOCOL_UNSUPPORTED', 'INVALID_COMMAND', 'INVALID_REQUEST', 'INVALID_PROFILE_URL',
  'INVALID_PROFILE_DIRECTORY', 'DOUYIN_BROWSER_NOT_FOUND', 'DOUYIN_CAPTURE_INVALID',
  'DOUYIN_CAPTURE_EMPTY', 'DOUYIN_RISK_CONTROL', 'DOUYIN_LOGIN_REQUIRED',
  'DOUYIN_LOGIN_CANCELLED', 'DOUYIN_NETWORK_TIMEOUT', 'SCRAPLING_ENGINE_INTERNAL'
] as const

const engineFailureCodeSchema = z.enum(SCRAPLING_ENGINE_ERROR_CODES)

function protocolString(maxCodePoints: number, minLength = 0) {
  return z.string()
    .refine((value) => value.length >= minLength, { message: `Expected at least ${minLength} characters` })
    .refine((value) => [...value].length <= maxCodePoints, { message: `Expected at most ${maxCodePoints} code points` })
}

const workSchema = z.object({
  id: z.string().regex(/^\d+$/),
  title: protocolString(10_000, 1),
  publishedAt: z.string().datetime(),
  originalUrl: z.string().url(),
  downloadUrl: z.string().url().nullable(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  collects: z.number().int().nonnegative()
}).strict()

const captureSuccessSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(true),
  creator: z.object({ name: z.string().min(1), profileUrl: z.string().url() }).strict(),
  works: z.array(workSchema).max(200),
  complete: z.boolean().optional(),
  missingWorkIds: z.array(z.string().regex(/^\d+$/)).max(60).optional(),
  pagesCaptured: z.number().int().nonnegative().optional()
}).strict()

const loginStatusSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(true),
  loggedIn: z.boolean()
}).strict()

const diagnosticSchema = z.object({
  payloadCount: z.number().int().nonnegative().optional(),
  responses: z.array(z.object({
    urlPath: protocolString(300),
    httpStatus: z.number().int().nullable(),
    bodyBytes: z.number().int().nonnegative()
  }).strict()).max(20).optional(),
  payloads: z.array(z.object({
    statusCode: z.unknown().optional(),
    statusMessage: protocolString(300).nullable().optional(),
    loginGuide: z.boolean().optional(),
    awemeCount: z.number().int().nonnegative().nullable().optional(),
    keys: z.array(protocolString(100)).max(40).optional(),
    valueType: protocolString(100).optional()
  }).strict()).max(20).optional(),
  exceptionType: protocolString(100).optional(),
  errorMessage: protocolString(500).optional()
}).strict()

const captureVideoSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(true),
  work: workSchema
}).strict()

const failureSchema = z.object({
  protocolVersion: z.literal(SCRAPLING_ENGINE_PROTOCOL_VERSION),
  ok: z.literal(false),
  error: z.object({
    code: engineFailureCodeSchema,
    message: protocolString(500),
    diagnostic: diagnosticSchema.optional()
  }).strict()
}).strict()

export type ScraplingCaptureResult = z.infer<typeof captureSuccessSchema>
export type ScraplingWork = z.infer<typeof workSchema>

export interface ScraplingCaptureRequest {
  command: 'capture_creator'
  creatorId: string
  profileUrl: string
  profileDirectory: string
}

interface RunnerDependencies {
  invoke(command: EngineCommand, input: string, timeoutMs: number): Promise<string>
}

export class ScraplingEngineRunner {
  constructor(private readonly dependencies: RunnerDependencies = { invoke: invokeEngine }) {}

  async health(command: EngineCommand): Promise<void> {
    const output = await this.dependencies.invoke(command, JSON.stringify({
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
    command: EngineCommand,
    request: ScraplingCaptureRequest
  ): Promise<ScraplingCaptureResult> {
    return this.run(command, {
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      ...request
    }, 210_000, captureSuccessSchema)
  }

  async login(command: EngineCommand, profileDirectory: string): Promise<void> {
    await this.run(command, {
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      command: 'login',
      profileDirectory
    }, 700_000, loginStatusSchema)
  }

  async loginStatus(command: EngineCommand, profileDirectory: string): Promise<{ loggedIn: boolean }> {
    const result = await this.run(command, {
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      command: 'login_status',
      profileDirectory
    }, 45_000, loginStatusSchema)
    return { loggedIn: result.loggedIn }
  }

  async captureVideo(command: EngineCommand, profileDirectory: string, videoId: string): Promise<ScraplingWork> {
    const result = await this.run(command, {
      protocolVersion: SCRAPLING_ENGINE_PROTOCOL_VERSION,
      command: 'capture_video',
      profileDirectory,
      videoId
    }, 60_000, captureVideoSchema)
    return result.work
  }

  private async run<T extends z.ZodTypeAny>(
    command: EngineCommand,
    request: Record<string, unknown>,
    timeoutMs: number,
    successSchema: T
  ): Promise<z.infer<T>> {
    const output = await this.dependencies.invoke(command, JSON.stringify(request), timeoutMs)
    const parsed = parseJson(output)
    if (typeof parsed === 'object' && parsed !== null && 'protocolVersion' in parsed
      && parsed.protocolVersion !== SCRAPLING_ENGINE_PROTOCOL_VERSION) {
      throw runnerError('SCRAPLING_ENGINE_PROTOCOL_UNSUPPORTED', false)
    }
    const failure = failureSchema.safeParse(parsed)
    if (failure.success) {
      if (failure.data.error.diagnostic) {
        console.warn('Scrapling engine reported failure', {
          code: failure.data.error.code
        })
      }
      const nonRetryable = ['DOUYIN_RISK_CONTROL', 'DOUYIN_BROWSER_NOT_FOUND', 'DOUYIN_LOGIN_REQUIRED']
        .includes(failure.data.error.code)
      throw Object.assign(new Error(failure.data.error.message), {
        code: failure.data.error.code,
        retryable: !nonRetryable,
        ...(failure.data.error.diagnostic ? { diagnostic: failure.data.error.diagnostic } : {})
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

function invokeEngine(command: EngineCommand, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(runnerError('SCRAPLING_ENGINE_TIMEOUT')))
    }, timeoutMs)
    const settleOnClose = (code: number | null): void => {
      const stderrSummary = summarizeScraplingEngineStderr(stderr)
      if (stderrSummary) console.warn('Scrapling engine stderr', stderrSummary)
      if (code === 0) finish(() => resolve(stdout))
      else finish(() => reject(runnerError('SCRAPLING_ENGINE_EXITED')))
    }
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('close', settleOnClose)
      callback()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000)
    })
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 10_000_000) {
        child.kill()
        finish(() => reject(runnerError('SCRAPLING_ENGINE_OUTPUT_TOO_LARGE')))
      }
    })
    child.once('error', () => finish(() => reject(runnerError('SCRAPLING_ENGINE_START_FAILED'))))
    child.once('close', settleOnClose)
    child.stdin.end(`${input}\n`, 'utf8')
  })
}

export function summarizeScraplingEngineStderr(value: string): Readonly<{ code: 'SCRAPLING_ENGINE_STDERR'; stderrBytes: number }> | null {
  if (!value) return null
  return Object.freeze({ code: 'SCRAPLING_ENGINE_STDERR', stderrBytes: Math.min(Buffer.byteLength(value, 'utf8'), 1_000_000) })
}

function runnerError(code: string, retryable = true): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(code), { code, retryable })
}
