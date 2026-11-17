'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

import { env } from '@/shared/lib/env'

type TurnstileApi = {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

type Props = {
  /** Receives a fresh token, or null when it expired / failed / was consumed. */
  onToken: (token: string | null) => void
  /** Increment after each submit: Turnstile tokens are single-use. */
  resetSignal?: number
}

/** True when a Turnstile site key is configured (CAPTCHA on). */
export const isCaptchaEnabled = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)

/**
 * Cloudflare Turnstile widget (explicit rendering, so it works in forms
 * that mount/unmount). Renders nothing when no site key is configured —
 * the server-side check is disabled in that case too.
 */
export function Turnstile({ onToken, resetSignal = 0 }: Props) {
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== 'undefined' && Boolean(window.turnstile),
  )

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!siteKey || !scriptReady || !container.current || !window.turnstile) return
    const id = window.turnstile.render(container.current, {
      sitekey: siteKey,
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
    })
    widgetId.current = id
    return () => {
      window.turnstile?.remove(id)
      widgetId.current = null
    }
  }, [siteKey, scriptReady])

  useEffect(() => {
    if (resetSignal === 0 || !widgetId.current) return
    window.turnstile?.reset(widgetId.current)
    onTokenRef.current(null)
  }, [resetSignal])

  if (!siteKey) return null
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={container} />
    </>
  )
}
