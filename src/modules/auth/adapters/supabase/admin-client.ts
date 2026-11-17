import { createClient } from '@supabase/supabase-js'

import { env } from '@/shared/lib/env'

/**
 * A Supabase client with the service role key: it bypasses RLS and can
 * create and delete users. Server only, for the few auth operations no user
 * session may do (guest accounts are created and cleaned up here).
 */
export function createSupabaseAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
