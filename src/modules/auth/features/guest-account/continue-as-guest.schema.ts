import { z } from 'zod'

import {
  GUEST_NICKNAME_PATTERN,
  GUEST_NICKNAME_RULE,
  normalizeGuestNickname,
} from '../../domain/guest'

/**
 * A guest's nickname and password. The nickname is trimmed and lowercased
 * before it is checked, so `Wolf` and `wolf ` are the same account.
 */
export const continueAsGuestSchema = z.object({
  nickname: z
    .string()
    .max(200)
    .transform(normalizeGuestNickname)
    .pipe(z.string().regex(GUEST_NICKNAME_PATTERN, GUEST_NICKNAME_RULE)),
  password: z.string().min(8).max(72),
  // The Turnstile token; absent while the CAPTCHA is off.
  captchaToken: z.string().max(4096).optional(),
})

export type ContinueAsGuestInput = z.infer<typeof continueAsGuestSchema>
