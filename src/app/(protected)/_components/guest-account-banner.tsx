'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PROTECT_ACCOUNT_PATH } from '@/modules/auth/client'

/**
 * Stays at the top of every protected page while a guest account has no way
 * back if the password is lost, except on the protect page itself, which it
 * would only repeat.
 *
 * The protected layout decides whether the account needs it (on the server);
 * this decides where to show it, from the current path: Next keeps a shared
 * layout mounted across client-side navigations, so a path read there would
 * be out of date, for example after following the banner's own link.
 */
export function GuestAccountBanner({ nickname }: { nickname: string | null }) {
  const pathname = usePathname()
  if (pathname === PROTECT_ACCOUNT_PATH) return null

  // One string: JSX whitespace between an expression and text is not reliable.
  const headline = `${nickname ? `${nickname}, your` : 'Your'} guest account can't be recovered`

  return (
    <aside
      aria-label="Account protection warning"
      className="border-border bg-muted text-foreground sticky top-0 z-50 border-b px-4 py-2 text-sm"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
        <p>
          <strong>{headline}</strong> if you forget the password. Add a verified email or link
          Google or Facebook to protect it.
        </p>
        <Link
          href={PROTECT_ACCOUNT_PATH}
          className="border-border bg-background rounded-md border px-3 py-1 font-medium whitespace-nowrap underline-offset-2 hover:underline"
        >
          Protect account
        </Link>
      </div>
    </aside>
  )
}
