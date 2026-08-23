import { describe, expect, it } from 'vitest'
import { detectAgentCli } from '../../src/services/agent/agent-cli-detector'

const codexCommand = 'C:\\Program Files\\Codex\\codex.cmd'
const fallbackCodexCommand = 'C:\\Users\\virtual-user\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.cmd'

const existsProbe = (existingCommand: string) => ({
  commandExists: async (command: string) => command === existingCommand
})

describe('agent-cli-detector environment handling', () => {
  it('uses a configured Codex command without real filesystem dependencies', async () => {
    const env: NodeJS.ProcessEnv = {
      USERPROFILE: 'C:\\Users\\virtual-user',
      CONTENT_RADAR_AGENT_CLI: codexCommand,
    }
    const result = await detectAgentCli(existsProbe(codexCommand), env)
    expect(result).toMatchObject({ command: codexCommand })
  })

  it('derives LOCALAPPDATA from USERPROFILE when it is absent', async () => {
    const result = await detectAgentCli(existsProbe(fallbackCodexCommand), {
      USERPROFILE: 'C:\\Users\\virtual-user',
    })

    expect(result).toMatchObject({ command: fallbackCodexCommand })
  })
})
