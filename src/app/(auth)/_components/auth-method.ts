/**
 * The auth pages start with a choice: a secure account (email, Google or
 * Facebook) or a guest account (nickname and password). Then only that
 * path's options show.
 *
 * The step lives in the URL (`?method=account|guest`), so the back button,
 * links and error redirects work. The last choice is remembered in a
 * preference cookie holding only "account" or "guest" (nothing about the
 * person), read on the server so the remembered step renders at once.
 */
export type AuthMethod = 'account' | 'guest'

export const AUTH_METHOD_COOKIE = 'auth_method'
const AUTH_METHOD_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function parseAuthMethod(value: unknown): AuthMethod | null {
  return value === 'account' || value === 'guest' ? value : null
}

/**
 * The step to show, or null for the choice. A step in the URL comes first;
 * then an error, which only the OAuth callback sends here, so its step is
 * the account one; then the remembered choice.
 */
export function resolveAuthMethod(input: {
  param: string | undefined
  remembered: string | undefined
  error: string | undefined
}): AuthMethod | null {
  const explicit = parseAuthMethod(input.param)
  if (explicit) return explicit
  if (input.error) return 'account'
  return parseAuthMethod(input.remembered)
}

/** Browser only: remembers the choice for the next visit, or forgets it (null). */
export function rememberAuthMethod(method: AuthMethod | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    method === null
      ? `${AUTH_METHOD_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
      : `${AUTH_METHOD_COOKIE}=${method}; Max-Age=${AUTH_METHOD_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`
}
