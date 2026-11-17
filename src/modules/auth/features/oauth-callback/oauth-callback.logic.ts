import type { AuthProvider } from '../../ports/auth-provider'

/**
 * Finishes an OAuth sign-in (Google, Facebook) after the provider redirects
 * back to the app's callback with a code.
 *
 * If the provider returned no name, the auth sync trigger's NOT NULL on
 * public.users.name rolls back the sign-up and Supabase answers with a
 * generic database error; it arrives here as EXTERNAL_SERVICE_ERROR.
 */
export async function completeOAuthSignInWith(
  { authProvider }: { authProvider: AuthProvider },
  code: string,
) {
  return authProvider.exchangeOAuthCode(code)
}
