import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_METADATA } from '../../src/shared/app-metadata'

describe('application metadata', () => {
  it('uses the confirmed product identity and first database schema', () => {
    expect(APP_METADATA.productName).toBe('HitMuse')
    expect(APP_METADATA.applicationId).toBe('com.hitmuse.desktop')
    expect(APP_METADATA.windowsAppUserModelId).toBe('com.hitmuse.desktop.HitMuse')
    expect(APP_METADATA.schemaVersion).toBe(1)
  })

  it('packages a stable Windows window and taskbar icon', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const iconPath = join(process.cwd(), 'resources/hitmuse.ico')

    expect(packageJson.build.appId).toBe(APP_METADATA.applicationId)
    expect(packageJson.build.win.icon).toBe('resources/hitmuse.ico')
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'src/renderer/public/hitmuse-mark.png',
      to: 'hitmuse-mark.png'
    })
    expect(existsSync(join(process.cwd(), 'src/renderer/public/hitmuse-mark.png'))).toBe(true)
    expect(existsSync(iconPath)).toBe(true)

    const icon = readFileSync(iconPath)
    const imageCount = icon.readUInt16LE(4)
    const sizes = Array.from({ length: imageCount }, (_, index) => {
      const width = icon.readUInt8(6 + index * 16)
      return width === 0 ? 256 : width
    })
    expect(sizes).toEqual(expect.arrayContaining([16, 24, 32, 48, 64, 128, 256]))
  })

  it('binds the packaged window to the Windows application identity', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

    expect(source.indexOf('app.setAppUserModelId(APP_METADATA.windowsAppUserModelId)')).toBeLessThan(
      source.indexOf('app.whenReady()')
    )
    expect(source).toContain('applyWindowsTaskbarIdentity(window, icon)')
    expect(source).toContain("window.on('show', () => applyWindowsTaskbarIdentity(window, icon))")
    expect(source).toContain('window.setIcon(icon)')
    expect(source).toContain('window.setAppDetails({')
    expect(source).toContain('appId: APP_METADATA.windowsAppUserModelId')
    expect(source).toContain('appIconPath: process.execPath')
  })
})
