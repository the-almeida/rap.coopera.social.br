import { cookies } from 'next/headers'
import Link from 'next/link'

import { AuthErrorBanner } from './auth-error-banner'
import { AUTH_METHOD_COOKIE, resolveAuthMethod } from './auth-method'
import { AuthMethodChooser } from './auth-method-chooser'
import { GuestForm } from './guest-form'
import { OtherWaysLink } from './other-ways-link'
import { RememberAuthMethod } from './remember-auth-method'

type Page = {
  path: '/sign-in' | '/sign-up'
  title: string
  crossLink: { prompt: string; label: string; href: '/sign-in' | '/sign-up' }
  accountForm: React.ReactNode
}

type Props = {
  page: Page
  searchParams: { error?: string | string[]; method?: string | string[] }
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * What /sign-in and /sign-up share: first the choice between a secure account
 * and a guest account, then only that path's options, with a way back. See
 * auth-method.ts for how the step is chosen and remembered.
 */
export async function AuthEntry({ page, searchParams }: Props) {
  const error = first(searchParams.error)
  const method = resolveAuthMethod({
    param: first(searchParams.method),
    remembered: (await cookies()).get(AUTH_METHOD_COOKIE)?.value,
    error,
  })

  if (method === 'guest') {
    // The same on both pages: one action signs in or creates the account.
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-xl font-semibold">Quick visitant access with Nickname</h1>
        </header>
        <GuestForm />
        <OtherWaysLink />
        <RememberAuthMethod method="guest" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{page.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {page.crossLink.prompt}{' '}
          <Link
            href={
              method === 'account' ? `${page.crossLink.href}?method=account` : page.crossLink.href
            }
            className="underline"
          >
            {page.crossLink.label}
          </Link>
          .
        </p>
      </header>
      <AuthErrorBanner error={error} context={page.path === '/sign-in' ? 'sign-in' : 'sign-up'} />
      {method === 'account' ? (
        <>
          {page.accountForm}
          <OtherWaysLink />
          <RememberAuthMethod method="account" />
        </>
      ) : (
        <AuthMethodChooser basePath={page.path} />
      )}
    </div>
  )
}
