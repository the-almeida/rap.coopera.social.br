import { env } from '@/shared/lib/env'

import { verifyTurnstileToken } from './turnstile'

/** Checks a Turnstile token with the configured secret (see turnstile.ts). */
export function verifyCaptcha(token: string | undefined, ip: string) {
  return verifyTurnstileToken({ token, ip, secret: env.TURNSTILE_SECRET_KEY })
}
