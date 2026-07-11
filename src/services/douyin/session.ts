import { BrowserWindow, session, type Debugger } from 'electron'
import type { Work } from '../../core/domain'
import { extractWorksFromPayload } from './discovery'
import { deduplicateWorks, normalizeCreatorUrl } from './normalizers'

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
      if (!debuggerClient.isAttached()) debuggerClient.attach('1.3')
      await debuggerClient.sendCommand('Network.enable')
      const onMessage = (
        _event: Electron.Event,
        method: string,
        parameters: Record<string, unknown>
      ): void => {
        if (method !== 'Network.responseReceived') return
        const response = parameters.response as { mimeType?: string; url?: string } | undefined
        if (!response?.mimeType?.includes('json') || !response.url?.includes('douyin.com')) return
        const requestId = String(parameters.requestId ?? '')
        void this.captureResponseBody(debuggerClient, requestId, creatorId, captured)
      }
      debuggerClient.on('message', onMessage)

      await window.loadURL(url)
      await wait(8_000)
      const bodyText = await window.webContents.executeJavaScript(
        'document.body?.innerText?.slice(0, 4000) ?? ""',
        true
      ) as string
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
}
