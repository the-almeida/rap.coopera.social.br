import { z } from 'zod'

export const searchVulgosSchema = z.object({
  query: z.string().trim().min(1).max(60),
  limit: z.number().int().min(1).max(50).default(10),
})

export type SearchVulgosInput = z.input<typeof searchVulgosSchema>
