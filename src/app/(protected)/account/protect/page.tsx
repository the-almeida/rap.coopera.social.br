import Link from 'next/link'
import { redirect } from 'next/navigation'

import { env } from '@/shared/lib/env'

import {
  activeOAuthProviders,
  getAccountProtection,
  isGuestAccount,
  requireUser,
} from '@/modules/auth'

import { AddEmailForm } from './add-email-form'
import { LinkOAuthButtons } from './link-oauth-buttons'

export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ error?: string | string[] }>
}

// Only fixed text: nothing from the URL is shown.
const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Linking failed. Try again.',
  too_many_attempts: 'Too many attempts. Wait a minute and try again.',
  invalid_callback: 'The link was invalid or has expired. Try again.',
}

export default async function ProtectAccountPage({ searchParams }: Props) {
  const userResult = await requireUser()
  if (!userResult.ok) redirect('/sign-in')
  const user = userResult.value

  if (!isGuestAccount(user)) {
    return (
      <section className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Account protected</h1>
        <p className="text-muted-foreground text-sm">
          Your account uses <strong>{user.email}</strong> and can be recovered through it.
        </p>
        <Link href="/dashboard" className="text-sm underline">
          Back to the dashboard
        </Link>
      </section>
    )
  }

  const params = await searchParams
  const errorParam = Array.isArray(params.error) ? params.error[0] : params.error
  const errorMessage = errorParam ? (ERROR_MESSAGES[errorParam] ?? null) : null
  const protection = await getAccountProtection(user)
  const providers = activeOAuthProviders(env)

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Protect your account</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          You joined as <strong>{protection.nickname}</strong> with a nickname and a password.{' '}
          {protection.needsProtection ? (
            <>
              If you forget the password, <strong>the account cannot be recovered</strong>. Add a
              verified email or link a provider to fix that.
            </>
          ) : (
            <>A linked provider already protects it; you can also add an email.</>
          )}
        </p>
      </header>

      {errorMessage ? (
        <p
          role="alert"
          className="border-border bg-background text-foreground rounded-md border px-3 py-2 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}

      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-lg font-semibold">Add a verified email</h2>
        <p className="text-muted-foreground text-sm">
          We send a 6-digit code to confirm the address. Then you can sign in with the email or the
          nickname (same password), and recover the account through the email.
        </p>
        <AddEmailForm />
      </section>

      {providers.length > 0 ? (
        <section className="border-border space-y-3 rounded-md border p-4">
          <h2 className="text-lg font-semibold">Link Google or Facebook</h2>
          <p className="text-muted-foreground text-sm">
            Then you can also sign in with the provider, so the account stays reachable if you
            forget the password.
          </p>
          <LinkOAuthButtons providers={providers} />
        </section>
      ) : null}
    </section>
  )
}
