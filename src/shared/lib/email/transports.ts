import { ExternalServiceError } from '@/shared/lib/errors/base'
import { err, ok, type Result } from '@/shared/lib/result'
import { logger } from '@/shared/observability/logger'

export type EmailMessage = { to: string; subject: string; html: string; text: string }
export type EmailTransport = (message: EmailMessage) => Promise<Result<void, ExternalServiceError>>

export type EmailConfig = {
  resendApiKey?: string
  mailpitUrl?: string
  /** "Name <address>" or a bare address. Resend needs it, from a verified domain. */
  from?: string
}

const DEV_FROM = 'App <no-reply@localhost.test>'
const NOT_SENT = 'We could not send the email. Try again.'

function parseAddress(from: string): { Email: string; Name: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return match ? { Name: match[1] ?? '', Email: match[2]! } : { Name: '', Email: from.trim() }
}

// The provider's own text stays in `cause`: error messages can reach the browser.
async function post(
  service: string,
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit,
): Promise<Result<void, ExternalServiceError>> {
  try {
    const response = await fetchImpl(url, { ...init, method: 'POST' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // Expected errors are not reported on their own: an outage would go
      // unseen. Never the address: it is personal data.
      logger.error({ source: 'email', service, status: response.status }, 'Email not sent')
      return err(
        new ExternalServiceError(service, NOT_SENT, {
          cause: new Error(`${service} answered ${response.status}: ${detail.slice(0, 200)}`),
        }),
      )
    }
    return ok(undefined)
  } catch (cause) {
    logger.error({ source: 'email', service, err: cause }, 'Email not sent')
    return err(new ExternalServiceError(service, NOT_SENT, { cause }))
  }
}

/** Resend's HTTP API, the provider Supabase's own emails go through too. */
function resendTransport(apiKey: string, from: string, fetchImpl: typeof fetch): EmailTransport {
  return ({ to, subject, html, text }) =>
    post('resend', fetchImpl, 'https://api.resend.com/emails', {
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    })
}

/**
 * Mailpit's send API: the inbox that comes with the local Supabase stack, so
 * development, CI and e2e read the app's emails where Supabase's own land.
 */
function mailpitTransport(baseUrl: string, from: string, fetchImpl: typeof fetch): EmailTransport {
  return ({ to, subject, html, text }) =>
    post('mailpit', fetchImpl, new URL('/api/v1/send', baseUrl), {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: parseAddress(from),
        To: [{ Email: to, Name: '' }],
        Subject: subject,
        HTML: html,
        Text: text,
      }),
      signal: AbortSignal.timeout(5_000),
    })
}

/** Resend when configured, else Mailpit, else a transport that says nothing is configured. */
export function selectTransport(
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): EmailTransport {
  if (config.resendApiKey) {
    if (!config.from) {
      return async () =>
        err(
          new ExternalServiceError('email', NOT_SENT, {
            cause: new Error('EMAIL_FROM is required when RESEND_API_KEY is set'),
          }),
        )
    }
    return resendTransport(config.resendApiKey, config.from, fetchImpl)
  }
  if (config.mailpitUrl)
    return mailpitTransport(config.mailpitUrl, config.from ?? DEV_FROM, fetchImpl)
  return async () =>
    err(
      new ExternalServiceError('email', NOT_SENT, {
        cause: new Error('No email provider: set RESEND_API_KEY and EMAIL_FROM, or MAILPIT_URL'),
      }),
    )
}
