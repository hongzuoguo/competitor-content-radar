import type { AgentReasoningEffort } from '../../shared/ipc-contract'

export type AgentCliId = 'codex'

export interface DetectedAgentCli {
  id: AgentCliId
  /** Command to spawn. Prefer an absolute path when known. */
  command: string
  displayName: string
  /** Arguments used to run a single headless task. */
  execArgs(prompt: string, model?: string, reasoningEffort?: AgentReasoningEffort): string[]
}

export interface AgentCliDetectorOptions {
  /**
   * Probe whether a command is available. Receives the exact command string
   * (absolute path when known) plus the bare command name for PATH lookup.
   */
  commandExists(command: string, bareName: string): Promise<boolean>
}

interface AgentCliCandidate {
  id: AgentCliId
  /** Absolute install paths probed first (PATH-independent for desktop apps). */
  installPaths: string[]
  /** Bare command names probed via PATH as a fallback. */
  bareNames: string[]
  displayName: string
  execArgs(prompt: string, model?: string, reasoningEffort?: AgentReasoningEffort): string[]
}

/**
 * Candidate list. Known install locations are checked first (they do not
 * depend on the PATH inherited by a desktop-launched app), then `where` is
 * used as a fast fallback. No full PATH directory scan: that would spawn
 * hundreds of subprocess calls and freeze the main process.
 */
function buildCandidates(env: NodeJS.ProcessEnv = process.env): AgentCliCandidate[] {
  const win = (p: string): string => p.replaceAll('/', '\\')
  // Desktop-launched Electron may lack LOCALAPPDATA/APPDATA (they are not in
  // the registry; explorer injects them). Derive from USERPROFILE when missing.
  const userHome = win(env.USERPROFILE ?? '')
  const local = win(env.LOCALAPPDATA ?? '') || `${userHome}\\AppData\\Local`
  return [
    {
      id: 'codex',
      installPaths: [win(`${local}\\OpenAI\\Codex\\bin\\codex.cmd`)],
      bareNames: ['codex'],
      displayName: 'Codex',
      // --skip-git-repo-check: the app runs tasks from a non-git cwd, and
      // Codex refuses headless exec there without this flag.
      execArgs: (prompt, model, reasoningEffort) => [
        'exec',
        '--skip-git-repo-check',
        ...(model?.trim() ? ['--model', model.trim()] : []),
        ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []),
        prompt
      ]
    }
  ]
}

/**
 * Finds an installed Codex CLI.
 *
 * 0. A manually configured Codex path (env.CONTENT_RADAR_AGENT_CLI) wins when set.
 * 1. Known absolute install paths (drive-independent, PATH-independent).
 * 2. `where` fallback (fast PATH lookup by name).
 */
export async function detectAgentCli(options: AgentCliDetectorOptions, env: NodeJS.ProcessEnv = process.env): Promise<DetectedAgentCli | null> {
  const candidates = buildCandidates(env)

  // 0) Manual override: accept Codex paths only. Unknown CLIs have different
  // arguments and output contracts, so guessing would create false readiness.
  const manual = (env.CONTENT_RADAR_AGENT_CLI ?? '').trim()
  if (manual) {
    const basename = manual.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    const matched = /^codex(?:\.(?:exe|cmd|bat|ps1))?$/.test(basename)
      ? candidates[0]
      : undefined
    if (matched && await options.commandExists(manual, matched.bareNames[0])) {
      return { id: matched.id, command: manual, displayName: `${matched.displayName}（手动配置）`, execArgs: matched.execArgs }
    }
  }

  for (const candidate of candidates) {
    // 1) Known absolute install locations (PATH-independent for desktop apps).
    for (const installPath of candidate.installPaths) {
      if (await options.commandExists(installPath, candidate.bareNames[0])) {
        return {
          id: candidate.id,
          command: installPath,
          displayName: candidate.displayName,
          execArgs: candidate.execArgs
        }
      }
    }
    // 2) Fast PATH lookup via where.
    for (const bareName of candidate.bareNames) {
      if (await options.commandExists(bareName, bareName)) {
        return {
          id: candidate.id,
          command: bareName,
          displayName: candidate.displayName,
          execArgs: candidate.execArgs
        }
      }
    }
  }
  return null
}
