import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GitHub release configuration', () => {
  it('publishes stable updates to the public project', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { publish?: Array<Record<string, string>> }
    }
    expect(packageJson.build.publish).toEqual([{
      provider: 'github', owner: 'hongzuoguo', repo: 'competitor-content-radar', channel: 'latest'
    }])
    expect((packageJson.build as { win?: { artifactName?: string } }).win?.artifactName)
      .toBe('competitor-content-radar-setup-${version}.${ext}')
  })

  it('runs the release workflow only for version tags', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain('npm test -- --run')
    expect(workflow).toContain('npm run dist -- --publish always')
  })
})
