import { BrowserWindow, session, type Debugger } from 'electron'
import type { Work } from '../../core/domain'
import { extractWorkFromPayload, extractWorksFromPayload } from './discovery'
import { deduplicateWorks, normalizeCreatorUrl } from './normalizers'
import { withTimeout } from '../pipeline/timeout'

const PARTITION = 'persist:douyin-monitor'

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class DouyinBrowserSession {
  private readonly persistentSession = session.fromPartition(PARTITION)

  async openLoginWindow(): Promise<void> {
    const window = new BrowserWindow({
      width: 1080,
      height: 760,
      title: '登录抖音',
      webPreferences: {
        session: this.persistentSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    await window.loadURL('https://www.douyin.com/')
    await new Promise<void>((resolve) => window.once('closed', resolve))
  }

  async captureCreatorWorks(creatorId: string, profileUrl: string): Promise<Work[]> {
    const url = normalizeCreatorUrl(profileUrl)
    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      show: false,
      webPreferences: {
        session: this.persistentSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const captured: Work[] = []
    const debuggerClient = window.webContents.debugger

    try {
      await withTimeout(
        window.loadURL('about:blank'),
        10_000,
        Object.assign(new Error('抖音采集窗口初始化超时'), {
          code: 'DOUYIN_WINDOW_INIT_TIMEOUT',
          retryable: true
        })
      )
      if (!debuggerClient.isAttached()) debuggerClient.attach('1.3')
      await withTimeout(
        debuggerClient.sendCommand('Network.enable'),
        10_000,
        Object.assign(new Error('抖音采集器启动超时'), { code: 'DOUYIN_DEBUGGER_TIMEOUT', retryable: true })
      )
      const onMessage = (
        _event: Electron.Event,
        method: string,
        parameters: Record<string, unknown>
      ): void => {
        if (method !== 'Network.responseReceived') return
        const response = parameters.response as { mimeType?: string; url?: string } | undefined
        if (!isDouyinJsonResponse(response)) return
        const requestId = String(parameters.requestId ?? '')
        void this.captureResponseBody(debuggerClient, requestId, creatorId, captured)
      }
      debuggerClient.on('message', onMessage)

      await withTimeout(
        window.loadURL(url),
        30_000,
        Object.assign(new Error('抖音主页加载超时，请检查网络或重新登录抖音'), {
          code: 'DOUYIN_LOAD_TIMEOUT',
          retryable: true
        })
      )
      await wait(8_000)
      const bodyText = await withTimeout(
        window.webContents.executeJavaScript(
          'document.body?.innerText?.slice(0, 4000) ?? ""',
          true
        ) as Promise<string>,
        10_000,
        Object.assign(new Error('读取抖音主页超时，请重新登录抖音后重试'), {
          code: 'DOUYIN_PAGE_READ_TIMEOUT',
          retryable: true
        })
      )
      if (/验证码|安全验证|访问过于频繁/.test(bodyText)) {
        const error = Object.assign(new Error('抖音需要人工完成安全验证'), {
          code: 'DOUYIN_RISK_CONTROL',
          retryable: false
        })
        throw error
      }
      return deduplicateWorks(captured)
    } finally {
      if (debuggerClient.isAttached()) debuggerClient.detach()
      if (!window.isDestroyed()) window.destroy()
    }
  }

  async captureSingleVideo(
    videoId: string,
    url: string
  ): Promise<{ title: string; downloadUrl: string | null } | null> {
    const canonicalUrl = `https://www.douyin.com/video/${videoId}`
    if (url !== canonicalUrl || !/^\d+$/.test(videoId)) throw new Error('INVALID_DOUYIN_VIDEO_CAPTURE_REQUEST')
    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      show: false,
      webPreferences: {
        session: this.persistentSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const debuggerClient = window.webContents.debugger
    const pending = new Set<Promise<void>>()
    const captureState: { work: Work | null } = { work: null }
    let riskControlled = false
    const onMessage = (_event: Electron.Event, method: string, parameters: Record<string, unknown>): void => {
      if (method !== 'Network.responseReceived') return
      const response = parameters.response as { mimeType?: string; url?: string } | undefined
      if (!isDouyinJsonResponse(response)) return
      const task = this.captureSingleResponseBody(debuggerClient, String(parameters.requestId ?? ''), videoId)
        .then((result) => {
          if (result.riskControlled) riskControlled = true
          if (result.work) captureState.work = result.work
        })
        .finally(() => pending.delete(task))
      pending.add(task)
    }

    try {
      await withTimeout(window.loadURL('about:blank'), 10_000, new Error('DOUYIN_WINDOW_INIT_TIMEOUT'))
      if (!debuggerClient.isAttached()) debuggerClient.attach('1.3')
      await withTimeout(debuggerClient.sendCommand('Network.enable'), 10_000, new Error('DOUYIN_DEBUGGER_TIMEOUT'))
      debuggerClient.on('message', onMessage)
      await withTimeout(window.loadURL(canonicalUrl), 30_000, new Error('DOUYIN_LOAD_TIMEOUT'))
      await wait(8_000)
      await Promise.allSettled([...pending])
      const bodyText = await withTimeout(
        window.webContents.executeJavaScript('document.body?.innerText?.slice(0, 4000) ?? ""', true) as Promise<string>,
        10_000,
        new Error('DOUYIN_PAGE_READ_TIMEOUT')
      )
      if (riskControlled || isRiskControlText(bodyText)) return null
      return captureState.work
        ? { title: captureState.work.title, downloadUrl: captureState.work.downloadUrl }
        : null
    } finally {
      debuggerClient.removeListener('message', onMessage)
      await Promise.allSettled([...pending])
      if (debuggerClient.isAttached()) debuggerClient.detach()
      if (!window.isDestroyed()) window.destroy()
    }
  }

  private async captureResponseBody(
    debuggerClient: Debugger,
    requestId: string,
    creatorId: string,
    output: Work[]
  ): Promise<void> {
    try {
      const result = await debuggerClient.sendCommand('Network.getResponseBody', { requestId }) as {
        body?: string
      }
      if (!result.body) return
      output.push(...extractWorksFromPayload(creatorId, JSON.parse(result.body) as unknown))
    } catch {
      // Responses may be evicted before their body is read; the next captured response can still succeed.
    }
  }

  private async captureSingleResponseBody(
    debuggerClient: Debugger,
    requestId: string,
    videoId: string
  ): Promise<{ work: Work | null; riskControlled: boolean }> {
    try {
      const result = await withTimeout(
        debuggerClient.sendCommand('Network.getResponseBody', { requestId }),
        10_000,
        new Error('DOUYIN_RESPONSE_BODY_TIMEOUT')
      ) as { body?: string }
      if (!result.body) return { work: null, riskControlled: false }
      if (isRiskControlText(result.body)) return { work: null, riskControlled: true }
      return { work: extractWorkFromPayload(videoId, JSON.parse(result.body) as unknown), riskControlled: false }
    } catch {
      return { work: null, riskControlled: false }
    }
  }
}

export function isRiskControlText(value: string): boolean {
  try {
    return hasRiskControlSignal(JSON.parse(value) as unknown)
  } catch {
    return hasChallengeMeaning(value)
  }
}

function hasRiskControlSignal(value: unknown): boolean {
  if (typeof value === 'string') return hasChallengeMeaning(value)
  if (Array.isArray(value)) return value.some(hasRiskControlSignal)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    if (/^(?:captcha|captcha_(?:code|status)|risk_control(?:_(?:code|status))?|challenge_status)$/i.test(key)) {
      return isActiveChallengeValue(nested)
    }
    return hasRiskControlSignal(nested)
  })
}

function isActiveChallengeValue(value: unknown): boolean {
  if (value === true || (typeof value === 'number' && value > 0)) return true
  return typeof value === 'string' && (hasChallengeMeaning(value) || (/^\d+$/.test(value) && Number(value) > 0))
}

function hasChallengeMeaning(value: string): boolean {
  return /验证码|安全验证|人机验证|访问过于频繁|需要.{0,8}验证|captcha[_-]?challenge|risk[_-]?control[_-]?challenge/i.test(value)
}

export function isDouyinJsonResponse(response: { mimeType?: string; url?: string } | undefined): boolean {
  if (!response?.mimeType?.toLowerCase().includes('json') || !response.url) return false
  try {
    const url = new URL(response.url)
    return url.protocol === 'https:' && (url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))
  } catch {
    return false
  }
}
