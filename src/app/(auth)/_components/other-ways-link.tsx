'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/shared/ui/button'

import { rememberAuthMethod } from './auth-method'

/**
 * Back to step 1 (the chooser). Also forgets the remembered choice —
 * otherwise the chooser would immediately redirect to the same step again.
 */
// Deliberately free of "sign in"/"sign up": Playwright matches button names
// by substring, and `getByRole('button', { name: 'Sign in' })` is used
// across the suite (and in forks).
const LABEL = 'Choose another way'

export function OtherWaysLink() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={() => {
        rememberAuthMethod(null)
        if (searchParams.size > 0) router.push(pathname)
        else router.refresh()
      }}
    >
      ← {LABEL}
    </Button>
  )
}
