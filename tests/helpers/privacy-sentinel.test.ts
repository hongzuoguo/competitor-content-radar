import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireAbsent, scanForbiddenMedia } from './privacy-sentinel'

describe('privacy sentinel media scanner', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('fails a present forbidden file and passes a safe file without exposing the runtime value', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-scan-negative-'))
    roots.push(root)
    const file = join(root, 'forbidden.log')
    const sentinel = `runtime-${randomUUID()}`
    writeFileSync(file, sentinel, 'utf8')

    const leaked = scanForbiddenMedia([{ path: file, ruleId: 'FORBIDDEN_FILE' }], [sentinel])[0]
    writeFileSync(file, 'safe media', 'utf8')
    const safe = scanForbiddenMedia([{ path: file, ruleId: 'FORBIDDEN_FILE' }], [sentinel])[0]

    expect(leaked.status === 'PRODUCED').toBe(true)
    expect(leaked.present === true).toBe(true)
    expect(leaked.passed === false).toBe(true)
    expect(safe.status === 'PRODUCED').toBe(true)
    expect(safe.present === true).toBe(true)
    expect(safe.passed === true).toBe(true)
  })

  it('records a symlink scan failure instead of throwing raw filesystem details', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-scan-reparse-'))
    roots.push(root)
    const target = join(root, 'target')
    const link = join(root, 'link')
    mkdirSync(target)
    writeFileSync(join(target, 'safe.log'), 'safe media', 'utf8')
    symlinkSync(target, link, 'junction')

    const result = scanForbiddenMedia([{ path: link, ruleId: 'REPARSE_FILE' }], ['unused-sentinel'])[0]

    expect(result.status === 'SCAN_FAILED').toBe(true)
    expect(result.present === true).toBe(true)
    expect(result.passed === null).toBe(true)
    expect(result.errorCode === 'PRIVACY_MEDIA_REPARSE_POINT').toBe(true)
  })

  it('fails closed when an absence check cannot lstat its target', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const result = requireAbsent('unreadable-agent-probe.log', 'AGENT_PROBE_LOG', {
      lstat: () => { throw denied }
    })

    expect(result.status === 'SCAN_FAILED').toBe(true)
    expect(result.present === null).toBe(true)
    expect(result.passed === null).toBe(true)
    expect(result.errorCode === 'ABSENCE_CHECK_FAILED').toBe(true)
  })
})
