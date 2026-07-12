import type { Work } from '../../core/domain'
import { deduplicateWorks, normalizeDouyinWork } from './normalizers'

function collectAwemeLists(value: unknown, output: Array<Record<string, unknown>[]>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectAwemeLists(item, output)
    return
  }

  const record = value as Record<string, unknown>
  for (const [key, nested] of Object.entries(record)) {
    if ((key === 'aweme_list' || key === 'awemeList') && Array.isArray(nested)) {
      output.push(nested.filter((item): item is Record<string, unknown> => {
        return Boolean(item) && typeof item === 'object'
      }))
    } else {
      collectAwemeLists(nested, output)
    }
  }
}

export function extractWorksFromPayload(creatorId: string, payload: unknown): Work[] {
  const lists: Array<Record<string, unknown>[]> = []
  collectAwemeLists(payload, lists)
  const works = lists
    .flat()
    .flatMap((raw) => {
      try {
        return [normalizeDouyinWork(creatorId, raw)]
      } catch {
        return []
      }
    })
  return deduplicateWorks(works)
}

export function extractWorkFromPayload(videoId: string, payload: unknown): Work | null {
  const candidates: Record<string, unknown>[] = []
  collectRecords(payload, candidates)
  for (const raw of candidates) {
    const candidateId = String(raw.aweme_id ?? raw.awemeId ?? raw.id ?? '')
    if (candidateId !== videoId) continue
    try {
      return normalizeDouyinWork('', raw)
    } catch {
      return null
    }
  }
  return null
}

function collectRecords(value: unknown, output: Record<string, unknown>[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output)
    return
  }
  const record = value as Record<string, unknown>
  output.push(record)
  for (const nested of Object.values(record)) collectRecords(nested, output)
}
