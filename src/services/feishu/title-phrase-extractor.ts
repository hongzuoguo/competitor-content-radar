import * as nodejieba from 'nodejieba'
import type { TagResult } from 'nodejieba'

const JOINABLE_TAGS = /^(?:a|ad|an|eng|n|ng|nr|ns|nt|nz|v|vd|vn|x)/u
const NOUN_TAGS = /^(?:eng|n|ng|nr|ns|nt|nz|x)/u
const VERB_TAGS = /^(?:v|vd|vn)/u
const WEAK_WORDS = new Set([
  '一个', '一种', '三个', '几个', '这些', '这个', '那个', '怎么', '如何',
  '为什么', '什么', '可以', '不能', '不会', '已经', '就是', '真的',
  '视频', '内容', '作品', '分享', '推荐', '实测', '方法', '教程'
])

/**
 * Use nodejieba as a mechanical title tokenizer. The result is deliberately
 * only a candidate list: the selected AI engine performs the semantic review.
 */
export function extractTitlePhraseCandidates(title: string): string[] {
  ensureNodejiebaDictionary()
  const tagged = nodejieba.tag(cleanTitle(title))
  const tokens = tagged.filter(isUsefulToken)
  const candidates: string[] = []

  for (const group of contiguousGroups(tagged, isUsefulToken)) {
    addCandidate(candidates, group.map((item) => item.word).join(''))

    for (let index = 0; index < group.length; index += 1) {
      const token = group[index]
      if (!VERB_TAGS.test(token.tag)) continue
      const nouns = group.slice(index + 1).filter((item) => NOUN_TAGS.test(item.tag))
      if (nouns.length >= 2) {
        addCandidate(candidates, `${nouns.map((item) => item.word).join('')}${token.word}`)
      }
    }

    const nounRuns = contiguousGroups(group, (item) => NOUN_TAGS.test(item.tag))
    for (const nounRun of nounRuns) {
      if (nounRun.length >= 2) addCandidate(candidates, nounRun.map((item) => item.word).join(''))
    }
  }

  for (const token of tokens) {
    if (Array.from(token.word).length >= 3) addCandidate(candidates, token.word)
  }
  return candidates.slice(0, 12)
}

let dictionaryLoaded = false

function ensureNodejiebaDictionary(): void {
  if (dictionaryLoaded) return
  const defaults = nodejieba as typeof nodejieba & {
    DEFAULT_DICT: string
    DEFAULT_HMM_DICT: string
    DEFAULT_USER_DICT: string
    DEFAULT_IDF_DICT: string
    DEFAULT_STOP_WORD_DICT: string
  }
  nodejieba.load({
    dict: unpackedPath(defaults.DEFAULT_DICT),
    hmmDict: unpackedPath(defaults.DEFAULT_HMM_DICT),
    userDict: unpackedPath(defaults.DEFAULT_USER_DICT),
    idfDict: unpackedPath(defaults.DEFAULT_IDF_DICT),
    stopWordDict: unpackedPath(defaults.DEFAULT_STOP_WORD_DICT)
  })
  dictionaryLoaded = true
}

function unpackedPath(value: string): string {
  return value.replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2')
}

function cleanTitle(value: string): string {
  return value
    .replace(/#[^#\s]+/gu, ' ')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim()
}

function isUsefulToken(token: TagResult): boolean {
  const value = token.word.trim()
  return Boolean(value)
    && JOINABLE_TAGS.test(token.tag)
    && !WEAK_WORDS.has(value)
    && !/^\d+$/u.test(value)
    && !/^[的了地得着过是有在把被与和及或而且]$/u.test(value)
}

function contiguousGroups(
  tokens: TagResult[],
  predicate: (token: TagResult) => boolean = (token) => JOINABLE_TAGS.test(token.tag)
): TagResult[][] {
  const groups: TagResult[][] = []
  let current: TagResult[] = []
  for (const token of tokens) {
    if (predicate(token)) current.push(token)
    else if (current.length > 0) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function addCandidate(target: string[], raw: string): void {
  const value = raw.trim()
  const length = Array.from(value).length
  if (length < 4 || length > 16 || WEAK_WORDS.has(value) || target.includes(value)) return
  target.push(value)
}
