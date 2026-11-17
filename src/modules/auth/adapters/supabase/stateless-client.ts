import { createClient } from '@supabase/supabase-js'

import { env } from '@/shared/lib/env'

/**
 * A Supabase client bound to no cookies or storage: whatever it signs in
 * lives in memory for one call, so it can check credentials without touching
 * the caller's session.
 */
export function createSupabaseStatelessClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
