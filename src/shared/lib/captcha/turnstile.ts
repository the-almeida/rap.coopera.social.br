import { ExternalServiceError, ValidationError } from '@/shared/lib/errors/base'
import { err, ok, type Result } from '@/shared/lib/result'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const captchaFailed = (message: string) =>
  new ValidationError({ formErrors: [], fieldErrors: { captchaToken: [message] } }, message)

/**
 * Checks a Cloudflare Turnstile token on the server.
 *
 * Without a secret the CAPTCHA is off and everything passes, like the other
 * optional services in development and CI. With one, a missing or rejected
 * token is refused, and so is every attempt while Cloudflare cannot be
 * reached: an outage must not turn the CAPTCHA off. Tokens are single-use.
 */
export async function verifyTurnstileToken(
  { token, ip, secret }: { token: string | undefined; ip: string; secret: string | undefined },
  fetchImpl: typeof fetch = fetch,
): Promise<Result<void, ValidationError | ExternalServiceError>> {
  if (!secret) return ok(undefined)
  if (!token) return err(captchaFailed('Complete the CAPTCHA.'))

  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  let success: unknown
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      return err(
        new ExternalServiceError('turnstile', 'The CAPTCHA check is unavailable. Try again.'),
      )
    }
    success = ((await response.json()) as { success?: unknown }).success
  } catch (cause) {
    return err(
      new ExternalServiceError('turnstile', 'The CAPTCHA check is unavailable. Try again.', {
        cause,
      }),
    )
  }

  if (success !== true) return err(captchaFailed('The CAPTCHA check failed. Try again.'))
  return ok(undefined)
}
