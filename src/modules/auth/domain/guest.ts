/**
 * Guest accounts: a nickname and a password, no email.
 *
 * Supabase Auth identifies password accounts by email, so a nickname maps to
 * an address on a domain nobody can own: `<nickname>@guest.invalid`. The
 * `.invalid` top-level domain is reserved (RFC 2606): it never resolves, so
 * no mailbox exists and mail to it is never delivered.
 *
 * A password is normally trusted only once it was proven together with the
 * mailbox (see "verified password" in CONTEXT.md). A guest address has no
 * mailbox and no prior owner, so creating the account is the only proof
 * there can be, and the password is verified at creation. That holds only
 * while two rules do:
 *
 *   1. Guest addresses are created only on the server, from nicknames that
 *      match GUEST_NICKNAME_PATTERN. No `@`, dots or `+`, so a nickname maps
 *      to exactly one address and never to a real one.
 *   2. Nobody else can hold a guest address. Every email field in the app
 *      rejects the domain (EmailSchema), and the database refuses a guest
 *      address on any account the server did not mark as a guest
 *      (*_guest_domain_server_only.sql), which also covers calls straight to
 *      Supabase with the public key.
 *
 * The trade-off is said in the UI: a guest account cannot be recovered if
 * the password is lost, until the person adds a verified email or links
 * Google or Facebook.
 */

export const GUEST_EMAIL_DOMAIN = 'guest.invalid'

/** Lowercase letters, digits and underscore, 3 to 30 characters. */
export const GUEST_NICKNAME_PATTERN = /^[a-z0-9_]{3,30}$/

export const GUEST_NICKNAME_RULE =
  'Nickname must be 3 to 30 characters: lowercase letters, numbers and _'

export function normalizeGuestNickname(raw: string): string {
  return raw.trim().toLowerCase()
}

/** The caller passes a normalized, valid nickname (the schemas make sure). */
export function guestEmailFromNickname(nickname: string): string {
  return `${nickname}@${GUEST_EMAIL_DOMAIN}`
}

export function isGuestEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`)
}

/**
 * A guest account is one still on its guest address. Its nickname stays with
 * it after a real email is added, so the nickname alone does not tell.
 */
export function isGuestAccount(user: { email: string }): boolean {
  return isGuestEmail(user.email)
}

export const GUEST_EMAIL_REJECTION_MESSAGE =
  'This address is reserved for guest accounts. Guests sign in with their nickname instead.'
