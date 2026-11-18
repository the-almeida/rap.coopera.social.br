import { z } from 'zod'

import { EmailSchema } from '../../domain/email'

export const requestGuestEmailSchema = z.object({ email: EmailSchema })

export const verifyGuestEmailSchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit code'),
})
