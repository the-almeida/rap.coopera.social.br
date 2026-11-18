import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_TTL_MS = 15 * 60_000
export const MAX_ATTEMPTS = 5

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** Tied to the account and the address: a code is worth nothing for another one. */
export function hashCode(userId: string, email: string, code: string): string {
  return createHash('sha256').update(`${userId}:${email}:${code}`).digest('hex')
}

export function codeMatches(hash: string, userId: string, email: string, code: string): boolean {
  const expected = Buffer.from(hash, 'hex')
  const given = Buffer.from(hashCode(userId, email, code), 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function verificationEmail(code: string) {
  const intro = 'Enter this 6-digit code to add this email to your account:'
  const outro =
    'The code expires in 15 minutes. If you did not ask for it, ignore this email: nothing changes without the code.'
  return {
    subject: 'Your verification code',
    text: `${intro} ${code}\n\n${outro}`,
    html: `<p>${intro}</p>
<p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; padding: 20px;">${code}</p>
<p>${outro}</p>`,
  }
}
