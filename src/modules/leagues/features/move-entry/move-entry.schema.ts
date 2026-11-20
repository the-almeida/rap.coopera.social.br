import { z } from 'zod'

import { EntryIdSchema } from '@/shared/lib/ids'

export const moveEntrySchema = z.object({
  entryId: EntryIdSchema,
  /** New arrival position (1 = first). */
  toNumber: z.number().int().min(1),
})

export type MoveEntryInput = z.input<typeof moveEntrySchema>
