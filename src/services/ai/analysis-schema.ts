import { z } from 'zod'

export const AnalysisSchema = z.object({
  topicAngle: z.string().min(1),
  openingHook: z.object({
    quote: z.string().min(1),
    type: z.string().min(1),
    mechanism: z.string().min(1)
  }),
  structure: z.array(z.string().min(1)).min(1),
  viralPoints: z.array(z.string().min(1)),
  interactionGuidance: z.string().min(1),
  highlights: z.array(z.string().min(1)),
  reusablePatterns: z.array(z.string().min(1)),
  differentiatedSuggestions: z.object({
    angles: z.array(z.string().min(1)),
    titles: z.array(z.string().min(1)),
    openings: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1))
  }),
  referenceValueScore: z.number().min(0).max(100),
  referenceValueReason: z.string().min(1)
})

export type AnalysisResult = z.infer<typeof AnalysisSchema>
