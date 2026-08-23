import type { WeeklyTopicClusterResult } from '../ai/weekly-topic-clustering'

export interface TopicEvidenceWork {
  id: string
  title: string
  category: string
  keywords: string[]
  topicAngle: string
  viralPoints: string[]
}

export interface PersistedTopicAssignments {
  assignments: Record<string, string>
  categories: string[]
  signature?: string
}

export interface TopicAssignmentSet {
  assignments: Map<string, string>
  categories: string[]
}

export interface TopicClassificationSignatureInput {
  version: string
  works: TopicEvidenceWork[]
}

const MAX_TOPIC_CATEGORIES = 8
const OTHER_TOPIC = '其他方向'

export function createTopicClassificationSignature({
  version,
  works
}: TopicClassificationSignatureInput): string {
  return JSON.stringify({
    version,
    works: works
      .map((work) => ({
        id: work.id,
        title: work.title,
        category: work.category,
        keywords: work.keywords,
        topicAngle: work.topicAngle,
        viralPoints: work.viralPoints
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  })
}

export function assignmentsFromCluster(
  works: TopicEvidenceWork[],
  cluster: WeeklyTopicClusterResult
): TopicAssignmentSet {
  const expectedIds = new Set(works.map((work) => work.id))
  const assignments = new Map<string, string>()
  const categories: string[] = []
  const normalizedNames = new Set<string>()

  if (cluster.categories.length < 1 || cluster.categories.length > MAX_TOPIC_CATEGORIES) {
    throw new Error('AI_TOPIC_ASSIGNMENT_INVALID')
  }

  for (const category of cluster.categories) {
    const name = category.name.trim()
    const normalizedName = normalize(name)
    if (!name || normalizedNames.has(normalizedName)) {
      throw new Error('AI_TOPIC_ASSIGNMENT_INVALID')
    }
    normalizedNames.add(normalizedName)
    categories.push(name)

    for (const workId of category.workIds) {
      if (!expectedIds.has(workId) || assignments.has(workId)) {
        throw new Error('AI_TOPIC_ASSIGNMENT_INVALID')
      }
      assignments.set(workId, name)
    }
  }

  if (assignments.size !== expectedIds.size) {
    throw new Error('AI_TOPIC_ASSIGNMENT_INVALID')
  }

  return { assignments, categories }
}

export function fallbackTopicAssignments(
  works: TopicEvidenceWork[],
  previous?: PersistedTopicAssignments
): TopicAssignmentSet {
  const assignments = new Map<string, string>()
  const categories: string[] = []
  const allowedPrevious = new Set(
    (previous?.categories ?? []).map((category) => category.trim()).filter(Boolean)
  )

  const addCategory = (category: string): void => {
    if (!categories.includes(category)) categories.push(category)
  }

  for (const work of works) {
    const previousCategory = previous?.assignments[work.id]?.trim()
    if (previousCategory && allowedPrevious.has(previousCategory)) {
      assignments.set(work.id, previousCategory)
      addCategory(previousCategory)
    }
  }

  for (const work of works) {
    if (assignments.has(work.id)) continue
    const label = preferredFineCategory(work)
    const matchingCategory = categories.find((category) => areRelatedTopics(label, category))
    const category = matchingCategory ?? label
    assignments.set(work.id, category)
    addCategory(category)
  }

  if (categories.length <= MAX_TOPIC_CATEGORIES) {
    return { assignments, categories }
  }

  const counts = new Map<string, number>()
  for (const category of assignments.values()) {
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const order = new Map(categories.map((category, index) => [category, index]))
  const retained = categories
    .filter((category) => category !== OTHER_TOPIC)
    .sort((left, right) => (
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0)
      || (order.get(left) ?? 0) - (order.get(right) ?? 0)
    ))
    .slice(0, MAX_TOPIC_CATEGORIES - 1)
  const retainedSet = new Set(retained)

  for (const [workId, category] of assignments) {
    if (!retainedSet.has(category)) assignments.set(workId, OTHER_TOPIC)
  }

  return { assignments, categories: [...retained, OTHER_TOPIC] }
}

function preferredFineCategory(work: TopicEvidenceWork): string {
  return work.category.trim()
    || work.topicAngle.trim()
    || work.keywords.find((keyword) => keyword.trim())?.trim()
    || '未分类'
}

function areRelatedTopics(left: string, right: string): boolean {
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true

  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft
  if (shorter.length >= 4 && longer.includes(shorter)) return true

  const prefix = commonPrefix(normalizedLeft, normalizedRight)
  if (prefix.length < 4) return false
  if (/(方向|分类|主题|其他)$/.test(prefix)) return false
  return prefix.toLowerCase().startsWith('ai') || prefix.length >= 4
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[与和及]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]/g, '')
}

function commonPrefix(left: string, right: string): string {
  const leftCharacters = Array.from(left)
  const rightCharacters = Array.from(right)
  const length = Math.min(leftCharacters.length, rightCharacters.length)
  let index = 0
  while (index < length && leftCharacters[index] === rightCharacters[index]) index += 1
  return leftCharacters.slice(0, index).join('')
}
