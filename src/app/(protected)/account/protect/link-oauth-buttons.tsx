'use client'

import { useState } from 'react'

import { Button } from '@/shared/ui/button'

import {
  createSupabaseBrowserClient,
  OAUTH_PROVIDER_NAME,
  PROTECT_ACCOUNT_PATH,
  type OAuthProvider,
} from '@/modules/auth/client'

/**
 * Links Google or Facebook to the signed-in guest account (Supabase's manual
 * linking, `linkIdentity`, which needs "Allow manual linking" in Supabase).
 * The provider comes back through /auth/callback like a sign-in; `from`
 * brings a failure back to this page.
 */
export function LinkOAuthButtons({ providers }: { providers: readonly OAuthProvider[] }) {
  const [error, setError] = useState<string | null>(null)

  async function link(provider: OAuthProvider) {
    setError(null)
    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('next', PROTECT_ACCOUNT_PATH)
    callback.searchParams.set('from', PROTECT_ACCOUNT_PATH)
    const { error: linkError } = await createSupabaseBrowserClient().auth.linkIdentity({
      provider,
      options: { redirectTo: callback.toString() },
    })
    if (linkError) setError('Linking is unavailable right now. Try again.')
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => (
        <Button key={provider} type="button" variant="outline" onClick={() => link(provider)}>
          Link {OAUTH_PROVIDER_NAME[provider]}
        </Button>
      ))}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
