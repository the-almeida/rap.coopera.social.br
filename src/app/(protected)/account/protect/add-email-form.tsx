'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { requestGuestEmail, verifyGuestEmail } from '@/modules/auth/client'

type Stage = { kind: 'enter-email' } | { kind: 'awaiting-code'; email: string }

/**
 * Adds a verified email to a guest account: the app emails a 6-digit code to
 * the address, then checks it. Once it worked, the page renders the account
 * as protected and the banner goes.
 */
export function AddEmailForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'enter-email' })

  if (stage.kind === 'awaiting-code') {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          const code = String(new FormData(e.currentTarget).get('code') ?? '').trim()
          startTransition(async () => {
            const result = await verifyGuestEmail({ email: stage.email, code })
            if (!result.ok) {
              setError(result.error.message)
              return
            }
            router.refresh()
          })
        }}
      >
        <p className="text-muted-foreground text-sm">
          We sent a 6-digit code to{' '}
          <span className="text-foreground font-medium">{stage.email}</span>.
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            pattern="\d{6}"
            minLength={6}
            maxLength={6}
            className="tracking-widest"
          />
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Verifying…' : 'Verify and protect account'}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null)
            setStage({ kind: 'enter-email' })
          }}
        >
          Use a different email
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        const email = String(new FormData(e.currentTarget).get('email') ?? '').trim()
        startTransition(async () => {
          const result = await requestGuestEmail({ email })
          if (!result.ok) {
            setError(result.error.message)
            return
          }
          setStage({ kind: 'awaiting-code', email: result.value.email })
        })
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send verification code'}
      </Button>
    </form>
  )
}
