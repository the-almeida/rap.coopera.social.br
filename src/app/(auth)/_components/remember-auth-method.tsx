'use client'

import { useEffect } from 'react'

import { rememberAuthMethod, type AuthMethod } from './auth-method'

/**
 * Rendered by step 2: whatever brought the user here (the chooser, a deep
 * link, an error redirect, coming back after sign-out), this step becomes
 * the remembered choice for the next visit.
 */
export function RememberAuthMethod({ method }: { method: AuthMethod }) {
  useEffect(() => rememberAuthMethod(method), [method])
  return null
}
