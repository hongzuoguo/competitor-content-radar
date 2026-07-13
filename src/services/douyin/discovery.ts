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
  const candidates = findWorkRecordsFromPayload(videoId, payload)
  for (const raw of candidates) {
    try {
      const work = normalizeDouyinWork('', raw)
      if (work.downloadUrl?.trim()) return work
    } catch {
      continue
    }
  }
  return null
}

export function findWorkRecordsFromPayload(
  videoId: string,
  payload: unknown
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = []
  collectRecords(payload, candidates)
  return candidates.filter((raw) => {
    if (!isAwemeCandidate(raw)) return false
    const candidateId = String(raw.aweme_id ?? raw.awemeId ?? raw.id ?? '')
    return candidateId === videoId
  })
}

function isAwemeCandidate(raw: Record<string, unknown>): boolean {
  if (raw.aweme_id != null || raw.awemeId != null) return true
  return raw.id != null && (hasVideoAddress(raw.video) || Array.isArray(raw.images))
}

function hasVideoAddress(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const video = value as Record<string, unknown>
  const addresses = [video.play_addr, video.playAddress, video.download_addr, video.downloadAddress]
  return addresses.some((address) => {
    if (!address || typeof address !== 'object') return false
    const urls = (address as Record<string, unknown>).url_list
    return Array.isArray(urls) && typeof urls[0] === 'string' && urls[0].trim().length > 0
  })
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
