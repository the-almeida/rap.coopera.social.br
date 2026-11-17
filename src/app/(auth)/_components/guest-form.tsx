'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { isCaptchaEnabled, Turnstile } from '@/shared/ui/turnstile'

import { continueAsGuest } from '@/modules/auth/client'

/**
 * Guest access with a nickname: one step for a new nickname and a returning
 * one (the server signs in or creates). The same on /sign-in and /sign-up.
 * The warning is part of the deal: a guest account cannot be recovered if
 * the password is lost, until an email or Google/Facebook is added to it.
 */
export function GuestForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        const formData = new FormData(e.currentTarget)
        const nickname = String(formData.get('nickname') ?? '')
        const password = String(formData.get('password') ?? '')
        startTransition(async () => {
          const result = await continueAsGuest({
            nickname,
            password,
            captchaToken: captchaToken ?? undefined,
          })
          // Turnstile tokens work once: get a fresh one for any next try.
          setCaptchaReset((n) => n + 1)
          if (!result.ok) {
            setError(result.error.message)
            return
          }
          router.push('/dashboard')
          router.refresh()
        })
      }}
    >
      <p className="text-sm">
        New nickname? Your account is created at once. Coming back? Use the same nickname and
        password.
      </p>
      <p
        role="note"
        className="border-border bg-muted text-foreground rounded-md border px-3 py-2 text-sm"
      >
        <strong>Heads up:</strong> a guest account has no email, so it{' '}
        <strong>cannot be recovered</strong> if you forget the password. You can protect it later by
        adding an email or linking Google or Facebook.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="nickname">Nickname</Label>
        <Input
          id="nickname"
          name="nickname"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_]{3,30}"
          title="3 to 30 characters: letters, numbers and _"
          aria-describedby="nickname-rule"
        />
        <p id="nickname-rule" className="text-muted-foreground text-xs">
          3 to 30 characters: letters, numbers and underscore.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="guest-password">Password</Label>
        <Input
          id="guest-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={8}
          maxLength={72}
        />
      </div>
      <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending || (isCaptchaEnabled && !captchaToken)}>
        {isPending ? 'Just a moment…' : 'Continue as guest'}
      </Button>
    </form>
  )
}
