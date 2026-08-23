import { describe, expect, it } from 'vitest'
import { detectAgentCli, type AgentCliDetectorOptions } from '../../src/services/agent/agent-cli-detector'

/**
 * Simulates the probe: a bare name (e.g. 'codex') or an absolute install path
 * matches if it is in the available set. PATH lookup matches the bare name.
 */
function detector(available: string[]): AgentCliDetectorOptions {
  return {
    commandExists: async (command: string, bareName: string) =>
      available.includes(command) || available.includes(bareName)
  }
}

describe('agent-cli-detector (auto detection)', () => {
  it('detects Codex when it is available', async () => {
    const result = await detectAgentCli(detector(['codex']))
    expect(result).toMatchObject({ id: 'codex' })
  })

  it('does not treat unsupported CLIs as usable Codex engines', async () => {
    const result = await detectAgentCli(detector(['claude', 'cursor-agent', 'trae-cn', 'workbuddy']))
    expect(result).toBeNull()
  })

  it('returns null when no Agent CLI is installed', async () => {
    const result = await detectAgentCli(detector([]))
    expect(result).toBeNull()
  })

  it('exposes the exec argument template for headless runs', async () => {
    const result = await detectAgentCli(detector(['codex']))
    expect(result?.execArgs('任务单')).toBeInstanceOf(Array)
    expect(result?.execArgs('任务单').join(' ')).toContain('任务单')
  })

  it('builds the official Codex model override arguments when a model is selected', async () => {
    const result = await detectAgentCli(detector(['codex']))
    expect(result?.execArgs('任务单', 'gpt-5.4')).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.4',
      '任务单'
    ])
  })

  it('builds separate model and reasoning-effort overrides', async () => {
    const result = await detectAgentCli(detector(['codex']))
    expect(result?.execArgs('任务单', 'gpt-5.6-luna', 'max')).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.6-luna',
      '-c',
      'model_reasoning_effort="max"',
      '任务单'
    ])
  })

  it('prefers the absolute install path over PATH when the app lacks user PATH', async () => {
    const result = await detectAgentCli({
      commandExists: async (command: string, bareName: string) => {
        if (bareName === 'codex' && command.includes('OpenAI\\Codex')) return true
        return false
      }
    })
    expect(result?.id).toBe('codex')
    expect(result?.command).toContain('OpenAI\\Codex')
  })

  it('does not spawn PATH directory scans (fast known-path + where only)', async () => {
    const probed: string[] = []
    const result = await detectAgentCli({
      commandExists: async (command: string) => {
        probed.push(command)
        return command === 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.cmd'
      }
    }, {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      PATH: 'C:\\Windows\\system32;' + Array.from({ length: 50 }, (_, i) => `D:\\dir${i}`).join(';')
    } as NodeJS.ProcessEnv)
    expect(result?.id).toBe('codex')
    // Only known install paths were probed, not every PATH directory.
    expect(probed.length).toBeLessThan(20)
  })

  it('prefers a manually configured CLI path over auto-detection', async () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      CONTENT_RADAR_AGENT_CLI: 'D:\\tools\\codex.exe'
    } as NodeJS.ProcessEnv
    const result = await detectAgentCli({
      commandExists: async (command: string) => command === 'D:\\tools\\codex.exe'
    }, env)
    expect(result?.id).toBe('codex')
    expect(result?.command).toBe('D:\\tools\\codex.exe')
    expect(result?.displayName).toContain('手动配置')
  })

  it('rejects an unknown manual CLI instead of guessing its arguments', async () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      CONTENT_RADAR_AGENT_CLI: 'C:\\custom\\my-agent.exe'
    } as NodeJS.ProcessEnv
    const result = await detectAgentCli({
      commandExists: async (command: string) => command === 'C:\\custom\\my-agent.exe'
    }, env)
    expect(result).toBeNull()
  })

  it('does not accept a different executable merely because its name starts with codex', async () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      CONTENT_RADAR_AGENT_CLI: 'C:\\custom\\codex-helper.exe'
    } as NodeJS.ProcessEnv
    const result = await detectAgentCli({
      commandExists: async (command: string) => command === 'C:\\custom\\codex-helper.exe'
    }, env)
    expect(result).toBeNull()
  })
})
