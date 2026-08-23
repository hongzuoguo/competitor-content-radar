import type { RunHistoryItem } from '../../../../shared/ipc-contract'

export function formatRunCollectionSummary(run: RunHistoryItem): string {
  if (run.status === 'running') return `正在采集，当前已更新 ${run.discovered} 条`
  const failedSources = run.failures.filter((failure) => failure.stage === 'discovery').length
  return failedSources > 0
    ? `已采集/更新 ${run.discovered} 条，${failedSources} 个来源采集失败`
    : `采集/更新 ${run.discovered} 条`
}

export function formatRunAnalysisSummary(run: RunHistoryItem): string {
  if (run.status === 'running') return '采集完成后判断是否需要拆解'
  const analysisFailures = run.failures.filter((failure) => failure.stage === 'analysis').length
  if (run.selectedForAnalysis === 0) return '本次没有新增爆款需要拆解'
  if (analysisFailures > 0) {
    return `发现 ${run.selectedForAnalysis} 条爆款，成功拆解 ${run.analyzed} 条，失败 ${analysisFailures} 条`
  }
  return `发现 ${run.selectedForAnalysis} 条爆款，已拆解 ${run.analyzed} 条`
}

export function formatRunSuccessLabel(run: RunHistoryItem): string {
  return run.status === 'running' ? '采集中' : '采集完成'
}
