import { randomUUID } from 'node:crypto'

import { sql, TransactionRollbackError } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '@/shared/db/client'
import {
  cleanupAuthUser,
  createAnonSupabase,
  createTestUser,
  getAdminSupabase,
  markPasswordVerified,
} from '@/shared/db/test-helpers'

// What the public API (PostgREST, reachable with the public anon key) can
// touch in the public schema. The app itself uses the service role; these
// guard against the schema being exposed by Supabase's default grants.

const createdUserIds: string[] = []
afterEach(async () => {
  for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
})

describe('public schema exposure', () => {
  it('gives the API roles no write privileges on any table', async () => {
    // Writes go through the app (validation, policies) with the service
    // role. A write grant plus an ownership RLS policy would let any signed-in
    // user write their own rows straight through the REST API.
    const rows = await db.execute<{
      table_name: string
      grantee: string
      privilege_type: string
    }>(sql`
      SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      ORDER BY table_name, grantee, privilege_type
    `)

    expect(rows).toEqual([])
  })

  it('does not let a signed-in user insert rows through the REST API', async () => {
    const seeded = await createTestUser({ prefix: 'rest-write' })
    createdUserIds.push(seeded.id)
    const password = `pw-${randomUUID()}`
    await getAdminSupabase().auth.admin.updateUserById(seeded.id, { password })
    await markPasswordVerified(seeded.id)
    const client = createAnonSupabase()
    const signIn = await client.auth.signInWithPassword({ email: seeded.email, password })
    if (signIn.error) throw signIn.error

    const { error } = await client
      .from('example_entities')
      .insert({ user_id: seeded.id, title: 'Written past the app' })

    expect(error).not.toBeNull()
    const rows = await db.execute(
      sql`SELECT 1 FROM public.example_entities WHERE user_id = ${seeded.id}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('has RLS on every table', async () => {
    const rows = await db.execute<{ relname: string }>(sql`
      SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
    `)

    expect(rows.map((row) => row.relname)).toEqual([])
  })

  it('lets the API roles call no function in the public schema', async () => {
    // Every public function is an RPC endpoint for whoever may execute it, and
    // most here are SECURITY DEFINER (they bypass RLS). The app and Supabase
    // Auth call them with their own roles; the API roles must not.
    const rows = await db.execute<{ fn: string; role: string }>(sql`
      SELECT p.proname AS fn, r.role
      FROM pg_proc p
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE p.pronamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND has_function_privilege(r.role, p.oid, 'EXECUTE')
      ORDER BY 1, 2
    `)

    expect(rows.map((row) => `${row.fn} (${row.role})`)).toEqual([])
  })

  it('has no view the API roles can read past RLS', async () => {
    // A view applies the caller's RLS only with security_invoker; a
    // materialized view never does.
    const rows = await db.execute<{ relname: string }>(sql`
      SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND (
          (c.relkind = 'v' AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false))
          OR c.relkind = 'm'
        )
        AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
    `)

    expect(rows.map((row) => row.relname)).toEqual([])
  })

  it('does not let the anon key run the account purge', async () => {
    const { error } = await createAnonSupabase().rpc('purge_expired_account_deletions')

    expect(error).not.toBeNull()
  })

  it('gives a new table no privileges for anon or authenticated by default', async () => {
    // The probe table lives only inside a transaction that is rolled back.
    let privileges: { anon: boolean; authenticated: boolean } | undefined
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`CREATE TABLE public.zz_default_grants_probe (id int)`)
        const [row] = await tx.execute<{ anon: boolean; authenticated: boolean }>(sql`
          SELECT
            has_table_privilege('anon', 'public.zz_default_grants_probe', 'SELECT, INSERT, UPDATE, DELETE') AS anon,
            has_table_privilege('authenticated', 'public.zz_default_grants_probe', 'SELECT, INSERT, UPDATE, DELETE') AS authenticated
        `)
        privileges = row
        tx.rollback()
      })
      // tx.rollback() rejects with Drizzle's TransactionRollbackError, by design.
      .catch((error: unknown) => {
        if (!(error instanceof TransactionRollbackError)) throw error
      })

    expect(privileges).toEqual({ anon: false, authenticated: false })
  })
})
