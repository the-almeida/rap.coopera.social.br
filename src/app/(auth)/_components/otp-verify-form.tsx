'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { verifyOtp, verifyPassword } from '@/modules/auth/client'

type Props = {
  /** On sign-in the page must not confirm that the email has an account. */
  flow: 'sign-in' | 'sign-up'
  email: string
  /**
   * The password just typed, when this code step also verifies it (password
   * sign-up, or a password sign-in whose password was never verified).
   */
  password?: string
  /** Shown above the code field. */
  intro?: string
  onBack: () => void
}

export function OtpVerifyForm({ flow, email, password, intro, onBack }: Props) {
  const shownEmail = <span className="text-foreground font-medium">{email}</span>
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        const formData = new FormData(e.currentTarget)
        const token = String(formData.get('token') ?? '').trim()
        startTransition(async () => {
          const result =
            password === undefined
              ? await verifyOtp({ email, token })
              : await verifyPassword({ email, password, token })
          if (!result.ok) {
            setError(result.error.message)
            return
          }
          router.push('/dashboard')
          router.refresh()
        })
      }}
    >
      {intro ? <p className="text-sm">{intro}</p> : null}
      <p className="text-muted-foreground text-sm">
        {flow === 'sign-in' ? (
          <>If an account exists for {shownEmail}, we sent a 6-digit code.</>
        ) : (
          <>We sent a 6-digit code to {shownEmail}.</>
        )}
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="token">6-digit code</Label>
        <Input
          id="token"
          name="token"
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
        {isPending ? 'Verifying…' : 'Verify'}
      </Button>
      <Button type="button" variant="link" size="sm" onClick={onBack} disabled={isPending}>
        Use a different email
      </Button>
    </form>
  )
}
