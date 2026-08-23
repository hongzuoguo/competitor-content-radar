import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineCommand, ScraplingEngineLocator } from './command'

export function createSourceEngineLocator(root: string): ScraplingEngineLocator {
  const cwd = join(root, 'engine', 'scrapling')
  const file = join(cwd, '.venv', 'Scripts', 'python.exe')
  const source = join(cwd, 'scrapling_engine.py')

  return {
    async ensureInstalled(): Promise<EngineCommand> {
      try {
        await access(file)
        await access(source)
      } catch {
        throw Object.assign(new Error('SCRAPLING_ENGINE_PYTHON_UNAVAILABLE'), {
          code: 'SCRAPLING_ENGINE_PYTHON_UNAVAILABLE', retryable: false
        })
      }
      return { file, args: ['-u', source], cwd }
    }
  }
}
