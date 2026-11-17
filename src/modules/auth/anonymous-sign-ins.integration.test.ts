import { describe, expect, it } from 'vitest'

import { createAnonSupabase } from '@/shared/db/test-helpers'

// Accounts without credentials are not offered: a guest account has a
// nickname and a password. Supabase's own anonymous sign-in stays off, so
// nobody can create one with the public key either.
describe('anonymous sign-ins (local Supabase)', () => {
  it('are refused by Supabase Auth', async () => {
    const { data, error } = await createAnonSupabase().auth.signInAnonymously()

    expect(error?.code).toBe('anonymous_provider_disabled')
    expect(data.user).toBeNull()
  })
})
