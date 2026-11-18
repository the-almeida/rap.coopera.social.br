import { env } from '@/shared/lib/env'

import { selectTransport, type EmailMessage } from './transports'

export type { EmailMessage } from './transports'

/** Sends an email the app writes itself, through the configured provider (transports.ts). */
export function sendEmail(message: EmailMessage) {
  return selectTransport({
    resendApiKey: env.RESEND_API_KEY,
    mailpitUrl: env.MAILPIT_URL,
    from: env.EMAIL_FROM,
  })(message)
}
