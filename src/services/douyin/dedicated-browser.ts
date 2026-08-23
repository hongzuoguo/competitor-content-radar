import { existsSync, rmSync } from 'node:fs'
import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { join } from 'node:path'

type BrowserEnvironment = Record<string, string | undefined>
type SpawnBrowser = typeof nodeSpawn
type CloseBrowserProfile = (profileDirectory: string) => Promise<void>

const CLOSE_DEDICATED_BROWSER_SCRIPT = `
$profile = [Environment]::GetEnvironmentVariable('CONTENT_RADAR_DOUYIN_PROFILE')
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and
  $_.CommandLine -and
  -not $_.CommandLine.Contains('--type=') -and
  ($_.CommandLine.Contains("--user-data-dir=$profile") -or $_.CommandLine.Contains("--user-data-dir=\`"$profile\`""))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
`

export function findInstalledBrowser(
  env: BrowserEnvironment = process.env,
  exists: (path: string) => boolean = existsSync
): string {
  const candidates = [
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter((candidate): candidate is string => Boolean(candidate))

  const browser = candidates.find(exists)
  if (!browser) throw new Error('DOUYIN_BROWSER_NOT_FOUND')
  return browser
}

export async function launchDedicatedBrowser(
  profileDirectory: string,
  dependencies: {
    findBrowser?: () => string
    spawn?: SpawnBrowser
  } = {}
): Promise<void> {
  const browser = (dependencies.findBrowser ?? findInstalledBrowser)()
  const child = (dependencies.spawn ?? nodeSpawn)(browser, [
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.douyin.com/'
  ], {
    detached: true,
    windowsHide: false,
    stdio: 'ignore'
  })
  child.unref()
}

export async function closeDedicatedBrowser(
  profileDirectory: string,
  dependencies: { invoke?: CloseBrowserProfile } = {}
): Promise<void> {
  await (dependencies.invoke ?? invokeCloseDedicatedBrowser)(profileDirectory)
}

function invokeCloseDedicatedBrowser(profileDirectory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      CLOSE_DEDICATED_BROWSER_SCRIPT
    ], {
      windowsHide: true,
      env: { ...process.env, CONTENT_RADAR_DOUYIN_PROFILE: profileDirectory }
    }, (error) => error ? reject(error) : resolve())
  })
}

/**
 * 清除应用专属浏览器的登录会话（profile 目录）。
 * 会先关闭占用该目录的浏览器进程，再删除 profile，实现真正的“登出”。
 */
export async function clearDouyinProfile(
  profileDirectory: string,
  dependencies: {
    remove?: (directory: string) => void
    exists?: (path: string) => boolean
  } = {}
): Promise<void> {
  const remove = dependencies.remove ?? ((directory) => rmSync(directory, { recursive: true, force: true }))
  const exists = dependencies.exists ?? existsSync
  await closeDedicatedBrowser(profileDirectory)
  if (exists(profileDirectory)) {
    remove(profileDirectory)
  }
}
