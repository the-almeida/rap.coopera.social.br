import { authProvider } from '../../adapters/auth-provider.supabase'
import { isGuestAccount } from '../../domain/guest'
import type { User } from '../../domain/user'

export type AccountProtection = {
  /**
   * True while the account has no way back if the password is lost: a guest
   * account with neither a real email nor Google or Facebook linked. Shows
   * the banner on protected pages.
   */
  needsProtection: boolean
  /** The guest nickname; it stays with the account after an email is added. */
  nickname: string | null
}

/**
 * Whether the account can be recovered. A guest is protected once either way
 * back exists: a verified email (the account left the guest address) or a
 * linked OAuth provider. With no sign-in methods known, it fails closed and
 * keeps asking.
 */
export function resolveAccountProtection(
  user: Pick<User, 'email' | 'guestNickname'>,
  providers: string[],
): AccountProtection {
  const linkedOAuth = providers.some((provider) => provider !== 'email')
  return {
    needsProtection: isGuestAccount(user) && !linkedOAuth,
    nickname: user.guestNickname,
  }
}

/** For pages that already have the user; only guests cost a call to Supabase. */
export async function getAccountProtection(user: User): Promise<AccountProtection> {
  if (!isGuestAccount(user)) return resolveAccountProtection(user, [])
  return resolveAccountProtection(user, await authProvider.getCurrentIdentityProviders())
}
