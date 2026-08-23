import { z } from 'zod'

const GENERIC_TOPIC_CATEGORIES = new Set(['AI', '内容', '工具', '教程', '其他', '未分类'])

export const TopicCategorySchema = z.string().trim().min(2).max(12).refine(
  (value) => !GENERIC_TOPIC_CATEGORIES.has(value),
  'topicCategory must be a concrete creative direction'
)

export const ContentKeywordsSchema = z.array(z.string().trim().min(2).max(12))
  .min(2)
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'contentKeywords must be unique')

export const AnalysisSchema = z.object({
  topicCategory: TopicCategorySchema.optional(),
  contentKeywords: ContentKeywordsSchema.optional(),
  topicAngle: z.string().min(1),
  openingHook: z.object({
    quote: z.string().min(1),
    type: z.string().min(1),
    mechanism: z.string().min(1)
  }),
  structure: z.array(z.string().min(1)).min(1),
  viralPoints: z.array(z.string().min(1)),
  highlights: z.array(z.string().min(1)),
  reusablePatterns: z.array(z.string().min(1)),
  differentiatedSuggestions: z.object({
    angles: z.array(z.string().min(1)),
    titles: z.array(z.string().min(1)),
    openings: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1))
  })
})

export const GeneratedAnalysisSchema = AnalysisSchema.extend({
  topicCategory: TopicCategorySchema,
  contentKeywords: ContentKeywordsSchema
})

export type AnalysisResult = z.infer<typeof AnalysisSchema>
