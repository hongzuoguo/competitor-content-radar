import type { DashboardHighlight } from '../../../../shared/ipc-contract'

export type HighlightSortMode = 'heat' | 'performance'

const HEAT_PRIORITY: Record<NonNullable<DashboardHighlight['radarStatus']>, number> = {
  newly_viral: 0,
  warming: 1,
  strong: 2,
  watching: 3,
  cooling: 4
}

export function sortHighlights(
  highlights: readonly DashboardHighlight[],
  mode: HighlightSortMode
): DashboardHighlight[] {
  return highlights
    .map((highlight, index) => ({ highlight, index }))
    .sort((left, right) => {
      if (mode === 'heat') {
        const priority = heatPriority(left.highlight) - heatPriority(right.highlight)
        if (priority !== 0) return priority
      } else {
        const performance = compareNullableDescending(
          left.highlight.relativePerformanceMultiplier,
          right.highlight.relativePerformanceMultiplier
        )
        if (performance !== 0) return performance
      }
      const likes = right.highlight.likes - left.highlight.likes
      return likes !== 0 ? likes : left.index - right.index
    })
    .map(({ highlight }) => highlight)
}

function heatPriority(highlight: DashboardHighlight): number {
  return highlight.radarStatus ? HEAT_PRIORITY[highlight.radarStatus] : 5
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return right - left
}
