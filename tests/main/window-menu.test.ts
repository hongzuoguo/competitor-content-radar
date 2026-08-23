import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron window chrome', () => {
  it('removes only the application menu and retains native window chrome', () => {
    const main = readFileSync('src/main/index.ts', 'utf8')

    expect(main).toMatch(/import \{[^}]*\bMenu\b[^}]*\} from 'electron'/s)
    expect(main).toMatch(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?Menu\.setApplicationMenu\(null\)/)
    expect(main).not.toMatch(/\bframe:\s*false\b/)
    expect(main).not.toMatch(/\btitleBarStyle\b/)
  })
})
