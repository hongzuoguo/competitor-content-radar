export interface EngineCommand {
  file: string
  args: readonly string[]
  cwd: string
}

export interface ScraplingEngineLocator {
  ensureInstalled(): Promise<EngineCommand>
}
