import { z } from 'zod'

import { EmailSchema } from './email'
import { GUEST_NICKNAME_PATTERN, normalizeGuestNickname } from './guest'

/**
 * How one person points at another account (an admin adding an organizer):
 * the email of a secure account, or the nickname of a guest account, which
 * has no email anyone may see. Anything with an `@` is read as an email.
 */
export const AccountLoginSchema = z
  .string()
  .max(254)
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(
    z.union([
      EmailSchema.transform((email) => ({ kind: 'email' as const, email })),
      z
        .string()
        .transform(normalizeGuestNickname)
        .pipe(z.string().regex(GUEST_NICKNAME_PATTERN))
        .transform((nickname) => ({ kind: 'nickname' as const, nickname })),
    ]),
  )

export type AccountLogin = z.output<typeof AccountLoginSchema>
