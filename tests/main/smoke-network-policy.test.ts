import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CANONICAL_SMOKE_DENY_HOSTS, installSmokeNetworkPolicy } from '../../src/main/smoke-network-policy'

const hostsArgument = (path: string): string => `--hitmuse-smoke-deny-hosts-file=${path}`

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hitmuse-smoke-network-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('smoke network policy', () => {
  it('stays disabled without the exact smoke deny-hosts argument', () => {
    const onBeforeRequest = vi.fn()

    expect(installSmokeNetworkPolicy(
      ['HitMuse.exe', '--hitmuse-smoke-deny-hosts-file'],
      { webRequest: { onBeforeRequest } },
      { info: vi.fn() }
    )).toBe(false)
    expect(onBeforeRequest).not.toHaveBeenCalled()
  })

  it('cancels requests to a configured GitHub host but allows Douyin', async () => {
    await withFixture(async (root) => {
      const hostsFile = join(root, 'deny-hosts.json')
      await writeFile(hostsFile, JSON.stringify({ schemaVersion: 1, hosts: CANONICAL_SMOKE_DENY_HOSTS }))
      const onBeforeRequest = vi.fn()
      const log = { info: vi.fn() }

      expect(installSmokeNetworkPolicy(
        ['HitMuse.exe', hostsArgument(hostsFile)],
        { webRequest: { onBeforeRequest } },
        log
      )).toBe(true)

      const listener = onBeforeRequest.mock.calls[0][0] as (details: { url: string }, callback: (result: { cancel: boolean }) => void) => void
      const denied = vi.fn()
      const allowed = vi.fn()
      listener({ url: 'https://api.github.com/private/path?token=top-secret' }, denied)
      listener({ url: 'https://www.douyin.com/creator/42' }, allowed)

      expect(denied).toHaveBeenCalledWith({ cancel: true })
      expect(allowed).toHaveBeenCalledWith({ cancel: false })
      expect(log.info).toHaveBeenCalledWith({ ruleId: 'SMOKE_NETWORK_DENIED', hostname: 'api.github.com' })
      expect(log.info).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(log.info.mock.calls)).not.toContain('private/path')
      expect(JSON.stringify(log.info.mock.calls)).not.toContain('top-secret')
    })
  })

  it('rejects a malformed policy schema and non-lowercase hostname', async () => {
    await withFixture(async (root) => {
      const hostsFile = join(root, 'deny-hosts.json')
      await writeFile(hostsFile, JSON.stringify({ schemaVersion: 1, hosts: ['Api.GitHub.com'], extra: true }))

      expect(() => installSmokeNetworkPolicy(
        ['HitMuse.exe', hostsArgument(hostsFile)],
        { webRequest: { onBeforeRequest: vi.fn() } },
        { info: vi.fn() }
      )).toThrow('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
    })
  })

  it('rejects a minimally valid or replaced deny-host policy', async () => {
    await withFixture(async (root) => {
      const hostsFile = join(root, 'deny-hosts.json')
      for (const hosts of [
        ['api.github.com'],
        [...CANONICAL_SMOKE_DENY_HOSTS.slice(0, -1), 'example.com']
      ]) {
        await writeFile(hostsFile, JSON.stringify({ schemaVersion: 1, hosts }))
        expect(() => installSmokeNetworkPolicy(
          ['HitMuse.exe', hostsArgument(hostsFile)],
          { webRequest: { onBeforeRequest: vi.fn() } },
          { info: vi.fn() }
        )).toThrow('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
      }
    })
  })

  it('rejects a policy file reached through a reparse point', async () => {
    await withFixture(async (root) => {
      const source = join(root, 'source')
      const linked = join(root, 'linked')
      await mkdir(source)
      await writeFile(join(source, 'deny-hosts.json'), JSON.stringify({ schemaVersion: 1, hosts: ['api.github.com'] }))
      await symlink(source, linked, 'junction')

      expect(() => installSmokeNetworkPolicy(
        ['HitMuse.exe', hostsArgument(join(linked, 'deny-hosts.json'))],
        { webRequest: { onBeforeRequest: vi.fn() } },
        { info: vi.fn() }
      )).toThrow('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
    })
  })

  it('rejects more than 32 denied hosts', async () => {
    await withFixture(async (root) => {
      const hostsFile = join(root, 'deny-hosts.json')
      await writeFile(hostsFile, JSON.stringify({
        schemaVersion: 1,
        hosts: Array.from({ length: 33 }, (_, index) => `host-${index}.example.com`)
      }))

      expect(() => installSmokeNetworkPolicy(
        ['HitMuse.exe', hostsArgument(hostsFile)],
        { webRequest: { onBeforeRequest: vi.fn() } },
        { info: vi.fn() }
      )).toThrow('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
    })
  })

  it('rejects a policy file larger than 8 KiB', async () => {
    await withFixture(async (root) => {
      const hostsFile = join(root, 'deny-hosts.json')
      await writeFile(hostsFile, `${JSON.stringify({ schemaVersion: 1, hosts: ['api.github.com'] })}${' '.repeat(8 * 1024)}`)

      expect(() => installSmokeNetworkPolicy(
        ['HitMuse.exe', hostsArgument(hostsFile)],
        { webRequest: { onBeforeRequest: vi.fn() } },
        { info: vi.fn() }
      )).toThrow('HITMUSE_SMOKE_NETWORK_POLICY_INVALID')
    })
  })
})
