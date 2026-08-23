import type { ChatCompletionClient, ChatCompletionRequest } from './provider-types'

/**
 * AI rewriting service. Takes the AI analysis of a competitor's work plus the
 * user's context, then asks the model to produce a NEW article in the user's
 * voice while following the Humanizer-zh 24-pattern de-AI checklist
 * (op7418/Humanizer-zh, MIT).
 *
 * The original transcript is NOT used as source material: the output is a
 * fresh piece built from the analysis structure + user context. When the
 * model judges the context insufficient, it returns needMore with questions
 * so the UI can ask the user for more background, then retry with answers.
 */

export interface RewriteSource {
  title: string
  topicAngle: string
  openingHookQuote: string
  openingHookType: string
  openingHookMechanism: string
  structure: string
  viralPoints: string
  highlights: string[]
  reusablePatterns: string[]
}

export interface RewriteRequest {
  source: RewriteSource
  userContext: string
  /** Desired output length in Chinese characters. Defaults to 400. */
  wordCount?: number
  /** Answers to the model's clarifying questions from the previous round. */
  followUp?: { questions: string[]; answers: string }
}

export interface RewriteQualityScore {
  directness: number
  rhythm: number
  trust: number
  authenticity: number
  refinement: number
  total: number
}

export type RewriteResult =
  | { needMore: true; questions: string[]; content: null; score: null; usage: { inputTokens: number; outputTokens: number } | undefined }
  | { needMore: false; questions: []; content: string; score: RewriteQualityScore; usage: { inputTokens: number; outputTokens: number } | undefined }

/**
 * System prompt embeds the Humanizer-zh 24 anti-AI patterns as a guardrail
 * for the rewriting model. Translation of op7418/Humanizer-zh SKILL.md.
 */
export function buildSystemPrompt(wordCount: number): string {
  const target = clampWordCount(wordCount)
  return `你是「HitMuse」的中文文案改写助手。根据对标作品的 AI 拆解结构 + 用户的个性化背景,写一篇**全新**的文章(目标约 ${target} 字),不是复述原文,不是改写原文,而是按拆解出的结构与风格,结合用户背景,写一篇全新的、有观点、不像 AI 的文章。

## 重要:不参考原文
用户不会提供原文。你只能依据「AI 拆解结果」和「用户个性化背景」创作。不要编造原文中不存在的具体数字/事件;如果需要具体细节来让文章鲜活,把它写进反问(见下)问用户,而不是凭空杜撰。

## 交互规则(重要)
创作前先判断:仅凭「AI 拆解结果 + 用户背景」,能不能写出一篇具体、鲜活、不空洞的文章?
- **能** → 直接写,输出 JSON 形态 A。
- **不能**(背景太泛/缺具体场景/缺用户个人经历/缺目标读者) → 输出 JSON 形态 B,问 1-3 个最关键的问题(具体、能回答、有助于写作的),不要写文章。
- 如果本次请求带了「上一轮问题与回答」(followUp),把它一并当作背景,尽力直接写(形态 A),除非仍缺最关键信息才再问(形态 B)。

## 核心原则
1. 删除填充短语(此外、深入探讨、持久的、至关重要、增强、培养、获得、突出、相互作用、复杂的、格局、关键性的、展示、宝贵的、充满活力的)
2. 打破公式结构,避免二元对比、修辞性设置
3. 变化句子节奏,两项优于三项,段落结尾要多样化
4. 信任读者,跳过软化、辩解和手把手引导
5. 删除金句,如果读起来像可引用的话,重写它

## 必须避免的 24 种 AI 写作模式
- 内容:夸大意义/遗产/趋势;强调知名度/媒体;以 -ing 结尾的肤浅分析;宣传广告语;模糊归因;提纲式"挑战与展望"
- 语言:AI 高频词(此外/深入探讨/至关重要/持久的/增强/培养/获得/突出/相互作用/复杂/关键/格局/展示/织锦/宝贵的/充满活力的);回避"是";否定式排比(不仅…而且…);三段式法则;刻意换词;虚假范围
- 风格:破折号过度;粗体过度;内联标题列表;表情符号;弯引号
- 交流:协作痕迹(希望对您有帮助);知识截止免责声明;谄媚语气;填充短语;过度限定;通用积极结论

## 个性与灵魂
避免 AI 模式只是工作的一半。无菌、没有声音的写作和机器生成一样明显:
- 有观点,不只报告事实:"我真的不知道该怎么看待这件事"比中立列利弊有人味
- 变化节奏:短促有力 + 慢慢展开的长句交替
- 承认复杂性,允许混乱
- 适当使用"我",第一人称是诚实的
- 感受要具体,不要"这令人担忧",要"凌晨三点没人看着时它还在运转,这让人不安"

## 输出 JSON 格式
形态 A(信息足够,直接写文章):
{
  "needMore": false,
  "content": "全新文章(约 ${target} 字,自然、有节奏、有具体细节、不像 AI)",
  "score": {
    "directness": 1-10,
    "rhythm": 1-10,
    "trust": 1-10,
    "authenticity": 1-10,
    "refinement": 1-10,
    "total": 五项之和(满分 50)
  }
}

形态 B(背景不够,反问用户):
{
  "needMore": true,
  "questions": ["具体问题1", "具体问题2"],
  "content": null,
  "score": null
}

只返回一个合法 JSON 对象,不要其他文字。`
}

const DEFAULT_WORD_COUNT = 400

function clampWordCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WORD_COUNT
  return Math.min(2000, Math.max(100, Math.round(value)))
}

export function buildUserPrompt(req: RewriteRequest): string {
  const lines = [
    '## 对标作品标题',
    req.source.title || '(无)',
    '',
    '## AI 拆解结果(结构/角度/钩子/爆点/亮点,仅作为写作骨架,不复制其内容)',
    `- 角度:${req.source.topicAngle}`,
    `- 钩子:${req.source.openingHookQuote}(类型:${req.source.openingHookType};机制:${req.source.openingHookMechanism})`,
    `- 结构:${req.source.structure}`,
    `- 爆点:${req.source.viralPoints}`,
    `- 亮点:${req.source.highlights.join('、') || '—'}`,
    `- 可复用模式:${req.source.reusablePatterns.join('、') || '—'}`,
    '',
    '## 用户个性化背景',
    req.userContext?.trim() || '(未提供,按通用风格处理)'
  ]
  if (req.followUp && req.followUp.questions.length > 0 && req.followUp.answers.trim()) {
    lines.push(
      '',
      '## 上一轮你问的与用户回答(补充背景,请结合使用)',
      req.followUp.questions.map((q, index) => `Q${index + 1}: ${q}`).join('\n'),
      `A: ${req.followUp.answers.trim()}`
    )
  }
  return lines.filter((part, idx, arr) => !(part === '' && (idx === 0 || arr[idx - 1] === ''))).join('\n')
}

export class RewriteService {
  constructor(private readonly client: ChatCompletionClient) {}

  async rewrite(req: RewriteRequest): Promise<RewriteResult> {
    const request: ChatCompletionRequest = {
      messages: [
        { role: 'system', content: buildSystemPrompt(req.wordCount ?? DEFAULT_WORD_COUNT) },
        { role: 'user', content: buildUserPrompt(req) }
      ],
      temperature: 0.85,
      maxTokens: 2000,
      responseFormat: 'json_object'
    }
    let response
    try {
      response = await this.client.complete(request)
    } catch (error) {
      // Retry once on transient empty response, mirroring analysis-service.
      if (!isEmptyResponse(error)) throw error
      response = await this.client.complete(request)
    }
    return parseRewrite(response.content, response.usage)
  }
}

export function parseRewrite(
  raw: string,
  usage?: { inputTokens: number; outputTokens: number }
): RewriteResult {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('AI_REWRITE_INVALID')
  }
  if (typeof payload !== 'object' || payload === null) throw new Error('AI_REWRITE_INVALID')
  const data = payload as Record<string, unknown>

  const needMore = data.needMore === true
  if (needMore) {
    const questions = Array.isArray(data.questions)
      ? data.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 3)
      : []
    if (questions.length === 0) throw new Error('AI_REWRITE_INVALID')
    return { needMore: true, questions, content: null, score: null, usage }
  }

  const content = typeof data.content === 'string' ? data.content.trim() : ''
  if (!content) throw new Error('AI_REWRITE_INVALID')
  const scoreRaw = (data.score && typeof data.score === 'object' ? data.score : {}) as Record<string, unknown>
  const score: RewriteQualityScore = {
    directness: clampScore(scoreRaw.directness),
    rhythm: clampScore(scoreRaw.rhythm),
    trust: clampScore(scoreRaw.trust),
    authenticity: clampScore(scoreRaw.authenticity),
    refinement: clampScore(scoreRaw.refinement),
    total: 0
  }
  score.total = score.directness + score.rhythm + score.trust + score.authenticity + score.refinement
  return { needMore: false, questions: [], content, score, usage }
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 7
  return Math.max(1, Math.min(10, n))
}

function isEmptyResponse(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: string }).code
  return code === 'AI_EMPTY_RESPONSE'
}
