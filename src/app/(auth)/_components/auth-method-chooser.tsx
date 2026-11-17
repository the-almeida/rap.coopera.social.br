'use client'

import Link from 'next/link'

import type { AuthMethod } from './auth-method'

type Props = {
  basePath: '/sign-in' | '/sign-up'
}

const ACCOUNT_TITLE = {
  '/sign-up': 'Create secure/persistent account',
  '/sign-in': 'Sign in to your secure/persistent account',
} as const

/**
 * Step 1 of the auth entry: choose the kind of access. The real account is
 * the primary path (first, emphasized); quick nickname access second.
 */
export function AuthMethodChooser({ basePath }: Props) {
  // The chosen step remembers itself when it renders (RememberAuthMethod).
  const option = (method: AuthMethod) => ({ href: `${basePath}?method=${method}` })

  return (
    <nav aria-label="Choose how to continue" className="flex flex-col gap-3">
      <Link
        {...option('account')}
        className="bg-primary text-primary-foreground flex flex-col gap-1 rounded-md px-4 py-3 text-left"
      >
        <span className="font-medium">{ACCOUNT_TITLE[basePath]}</span>
        <span className="text-primary-foreground/80 text-xs">
          With your email, Google or Facebook. Recoverable if you lose access.
        </span>
      </Link>
      <Link
        {...option('guest')}
        className="border-border hover:bg-muted flex flex-col gap-1 rounded-md border px-4 py-3 text-left"
      >
        <span className="font-medium">Quick visitant access with Nickname</span>
        <span className="text-muted-foreground text-xs">
          No email needed. Can&apos;t be recovered if you forget the password, until you protect it.
        </span>
      </Link>
    </nav>
  )
}
