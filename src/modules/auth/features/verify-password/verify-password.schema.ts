import { z } from 'zod'

import { EmailSchema } from '../../domain/email'

export const verifyPasswordSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8).max(72),
  token: z.string().regex(/^\d{6}$/, 'token must be a 6-digit code'),
})

export type VerifyPasswordInput = z.infer<typeof verifyPasswordSchema>
