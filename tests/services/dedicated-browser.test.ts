import { describe, expect, it, vi } from 'vitest'
import { closeDedicatedBrowser, findInstalledBrowser, launchDedicatedBrowser } from '../../src/services/douyin/dedicated-browser'

describe('dedicated Douyin browser', () => {
  it('prefers Chrome and falls back to Edge', () => {
    const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }
    const exists = vi.fn((path: string) => path.includes('Microsoft\\Edge'))

    expect(findInstalledBrowser(env, exists)).toBe('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
  })

  it('launches a visible browser with the application-owned profile and returns immediately', async () => {
    const unref = vi.fn()
    const spawn = vi.fn().mockReturnValue({ unref })

    await launchDedicatedBrowser('C:\\Data\\profile', {
      findBrowser: () => 'C:\\Chrome\\chrome.exe',
      spawn
    })

    expect(spawn).toHaveBeenCalledWith('C:\\Chrome\\chrome.exe', [
      '--user-data-dir=C:\\Data\\profile',
      '--no-first-run',
      '--no-default-browser-check',
      'https://www.douyin.com/'
    ], expect.objectContaining({ detached: true, windowsHide: false, stdio: 'ignore' }))
    expect(unref).toHaveBeenCalled()
  })

  it('closes only the application-owned browser profile before background capture', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)

    await closeDedicatedBrowser('C:\\Data\\profile', { invoke })

    expect(invoke).toHaveBeenCalledWith('C:\\Data\\profile')
  })
})
