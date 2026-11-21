import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/shared/db/client'
import {
  battleRounds,
  battles,
  crowdDraws,
  crowdDrawTickets,
  editionEntries,
  editions,
  leagueOrganizers,
  leagues,
  mcProfiles,
  vulgoClaims,
  vulgos,
  withdrawals,
} from '@/shared/db/schema'
import { cleanupAuthUser, createTestUser } from '@/shared/db/test-helpers'
import type { EditionId, LeagueId, UserId, VulgoId } from '@/shared/lib/ids'

/**
 * Database-level guarantees of the battle-league schema (docs/mvp-spec.md).
 * The app enforces the workflow; these constraints make sure that even a
 * buggy action cannot corrupt a night's bracket or its history.
 */

/** Postgres SQLSTATE of a rejected query (Drizzle wraps driver errors). */
async function sqlState(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query
    return null
  } catch (error) {
    let current: unknown = error
    while (current && typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
      current = (current as { cause?: unknown }).cause
    }
    throw error
  }
}

const UNIQUE = '23505'
const FOREIGN_KEY = '23503'
const CHECK = '23514'

class Rollback extends Error {}

/** Runs `query` as anon/authenticated (what PostgREST does), then rolls back. */
async function asRole<T>(role: 'anon' | 'authenticated', userId: UserId | null, query: string) {
  let rows: T[] = []
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`))
      await tx.execute(
        sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role })}, true)`,
      )
      rows = (await tx.execute(sql.raw(query))) as unknown as T[]
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  return rows
}

const run = randomUUID().slice(0, 8)
let userId: UserId
let leagueId: LeagueId
const vulgoIds: VulgoId[] = []

async function newVulgo(name: string) {
  const [row] = await db
    .insert(vulgos)
    .values({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${run}` })
    .returning()
  vulgoIds.push(row!.id)
  return row!
}

async function newEdition(number: number) {
  const [row] = await db
    .insert(editions)
    .values({ leagueId, number, eventDate: '2026-11-14' })
    .returning()
  return row!
}

async function addEntries(editionId: EditionId, count: number) {
  const entries = []
  for (let n = 1; n <= count; n++) {
    const vulgo = await newVulgo(`MC ${randomUUID().slice(0, 6)}`)
    const [row] = await db
      .insert(editionEntries)
      .values({ editionId, vulgoId: vulgo.id, number: n })
      .returning()
    entries.push(row!)
  }
  return entries
}

beforeAll(async () => {
  userId = (await createTestUser({ prefix: `schema-${run}` })).id
  const [league] = await db
    .insert(leagues)
    .values({ name: 'Schema League', slug: `schema-${run}`, createdBy: userId })
    .returning()
  leagueId = league!.id
  await db.insert(leagueOrganizers).values({ leagueId, userId })
})

afterAll(async () => {
  await db.delete(leagues).where(eq(leagues.id, leagueId))
  for (const id of vulgoIds) await db.delete(vulgos).where(eq(vulgos.id, id))
  await cleanupAuthUser(userId)
})

describe('battle-league schema', () => {
  it('treats accent/case variants of a vulgo as the same name', async () => {
    const vulgo = await newVulgo('Zé Exemplo')
    expect(await sqlState(db.insert(vulgos).values({ name: 'ZE EXEMPLO', slug: vulgo.slug }))).toBe(
      UNIQUE,
    )
  })

  it('keeps arrival numbers unique per edition yet lets the list be reordered in one statement', async () => {
    const edition = await newEdition(1)
    const [first, second] = await addEntries(edition.id, 2)
    const extra = await newVulgo('Late MC')

    expect(
      await sqlState(
        db.insert(editionEntries).values({ editionId: edition.id, vulgoId: extra.id, number: 1 }),
      ),
    ).toBe(UNIQUE)
    expect(
      await sqlState(
        db
          .insert(editionEntries)
          .values({ editionId: edition.id, vulgoId: first!.vulgoId, number: 3 }),
      ),
    ).toBe(UNIQUE)

    // Swap #1 and #2 in a single UPDATE (needs the DEFERRABLE constraint).
    await db.execute(
      sql`UPDATE edition_entries SET number = 3 - number WHERE edition_id = ${edition.id}`,
    )
    const [swapped] = await db.select().from(editionEntries).where(eq(editionEntries.id, first!.id))
    expect(swapped?.number).toBe(2)
    expect(second).toBeDefined()
  })

  it('requires selected entries to say why they were selected', async () => {
    const edition = await newEdition(2)
    const [entry] = await addEntries(edition.id, 1)
    expect(
      await sqlState(
        db
          .update(editionEntries)
          .set({ status: 'selected' })
          .where(eq(editionEntries.id, entry!.id)),
      ),
    ).toBe(CHECK)
  })

  it('only accepts 8 or 16 brackets, set before the list leaves registration', async () => {
    const edition = await newEdition(3)
    expect(
      await sqlState(
        db.update(editions).set({ status: 'selection' }).where(eq(editions.id, edition.id)),
      ),
    ).toBe(CHECK)
    expect(
      await sqlState(
        db.update(editions).set({ bracketSize: 12 }).where(eq(editions.id, edition.id)),
      ),
    ).toBe(CHECK)
  })

  it("never lets a battle, ticket or withdrawal point at another edition's entries", async () => {
    const edition = await newEdition(4)
    const other = await newEdition(5)
    const [a] = await addEntries(edition.id, 1)
    const [foreign] = await addEntries(other.id, 1)

    expect(
      await sqlState(
        db.insert(battles).values({
          editionId: edition.id,
          phase: 1,
          position: 1,
          entryAId: a!.id,
          entryBId: foreign!.id,
        }),
      ),
    ).toBe(FOREIGN_KEY)

    const [draw] = await db
      .insert(crowdDraws)
      .values({ editionId: edition.id, reason: 'selection', slots: 2 })
      .returning()
    expect(
      await sqlState(
        db
          .insert(crowdDrawTickets)
          .values({ editionId: edition.id, drawId: draw!.id, entryId: foreign!.id, number: 1 }),
      ),
    ).toBe(FOREIGN_KEY)
  })

  it('keeps battle results consistent: winner in the battle, 3 rounds max, no ties', async () => {
    const edition = await newEdition(6)
    const [a, b, outsider] = await addEntries(edition.id, 3)
    const [battle] = await db
      .insert(battles)
      .values({ editionId: edition.id, phase: 1, position: 1, entryAId: a!.id, entryBId: b!.id })
      .returning()

    expect(
      await sqlState(
        db.update(battles).set({ winnerEntryId: outsider!.id }).where(eq(battles.id, battle!.id)),
      ),
    ).toBe(CHECK)
    expect(
      await sqlState(
        db
          .insert(battleRounds)
          .values({ battleId: battle!.id, roundNo: 1, votesA: 40, votesB: 40 }),
      ),
    ).toBe(CHECK)
    expect(
      await sqlState(
        db
          .insert(battleRounds)
          .values({ battleId: battle!.id, roundNo: 4, votesA: 41, votesB: 40 }),
      ),
    ).toBe(CHECK)

    await db
      .insert(battleRounds)
      .values({ battleId: battle!.id, roundNo: 1, votesA: 41, votesB: 40 })
    expect(
      await sqlState(
        db.insert(battleRounds).values({ battleId: battle!.id, roundNo: 1, votesA: 10, votesB: 9 }),
      ),
    ).toBe(UNIQUE)
  })

  it('gives every crowd draw ticket a distinct number', async () => {
    const edition = await newEdition(7)
    const [a, b] = await addEntries(edition.id, 2)
    const [draw] = await db
      .insert(crowdDraws)
      .values({ editionId: edition.id, reason: 'selection', slots: 1 })
      .returning()
    await db
      .insert(crowdDrawTickets)
      .values({ editionId: edition.id, drawId: draw!.id, entryId: a!.id, number: 1 })
    expect(
      await sqlState(
        db
          .insert(crowdDrawTickets)
          .values({ editionId: edition.id, drawId: draw!.id, entryId: b!.id, number: 1 }),
      ),
    ).toBe(UNIQUE)
  })

  it('enforces the withdrawal methods', async () => {
    const edition = await newEdition(8)
    const [a, b] = await addEntries(edition.id, 2)
    const [battle] = await db
      .insert(battles)
      .values({ editionId: edition.id, phase: 2, position: 1, entryAId: a!.id, entryBId: b!.id })
      .returning()
    const base = { editionId: edition.id, entryId: a!.id, battleId: battle!.id }

    expect(
      await sqlState(db.insert(withdrawals).values({ ...base, method: 'previous_opponent' })),
    ).toBe(CHECK)
    expect(
      await sqlState(
        db.insert(withdrawals).values({ ...base, method: 'walkover', replacementEntryId: b!.id }),
      ),
    ).toBe(CHECK)
    expect(await sqlState(db.insert(withdrawals).values({ ...base, method: 'crowd_draw' }))).toBe(
      CHECK,
    )
    await db.insert(withdrawals).values({ ...base, method: 'walkover' })
  })

  it('deletes a whole edition in one statement but never a vulgo with history', async () => {
    const edition = await newEdition(9)
    const [a, b] = await addEntries(edition.id, 2)
    const [battle] = await db
      .insert(battles)
      .values({ editionId: edition.id, phase: 1, position: 1, entryAId: a!.id, entryBId: b!.id })
      .returning()
    await db.insert(battleRounds).values({ battleId: battle!.id, roundNo: 1, votesA: 5, votesB: 3 })
    const [draw] = await db
      .insert(crowdDraws)
      .values({ editionId: edition.id, reason: 'selection', slots: 1 })
      .returning()
    await db
      .insert(crowdDrawTickets)
      .values({ editionId: edition.id, drawId: draw!.id, entryId: a!.id, number: 1 })
    await db
      .insert(withdrawals)
      .values({ editionId: edition.id, entryId: b!.id, battleId: battle!.id, method: 'walkover' })

    expect(await sqlState(db.delete(vulgos).where(eq(vulgos.id, a!.vulgoId)))).toBe(FOREIGN_KEY)

    await db.delete(editions).where(eq(editions.id, edition.id))
    expect(
      await db.select().from(editionEntries).where(eq(editionEntries.editionId, edition.id)),
    ).toHaveLength(0)
  })

  it('allows one open claim per MC per vulgo', async () => {
    const [profile] = await db
      .insert(mcProfiles)
      .values({ userId, slug: `schema-profile-${run}` })
      .returning()
    const vulgo = await newVulgo('Claimable')
    await db.insert(vulgoClaims).values({ vulgoId: vulgo.id, mcProfileId: profile!.id })
    expect(
      await sqlState(
        db.insert(vulgoClaims).values({ vulgoId: vulgo.id, mcProfileId: profile!.id }),
      ),
    ).toBe(UNIQUE)
    expect(
      await sqlState(
        db
          .insert(vulgoClaims)
          .values({ vulgoId: vulgo.id, mcProfileId: profile!.id, status: 'approved' }),
      ),
    ).toBe(CHECK)
  })
})

const BATTLE_LEAGUE_TABLES = [
  'mc_profiles',
  'vulgos',
  'vulgo_claims',
  'leagues',
  'league_organizers',
  'editions',
  'edition_entries',
  'crowd_draws',
  'crowd_draw_tickets',
  'battles',
  'battle_rounds',
  'withdrawals',
]

describe('battle-league tables and the public API', () => {
  it('give anon and authenticated no access at all; public data is served by the app', async () => {
    const rows = await db.execute<{ table_name: string; role: string }>(sql`
      SELECT t.table_name, r.role
      FROM unnest(ARRAY[${sql.join(
        BATTLE_LEAGUE_TABLES.map((table) => sql`${table}`),
        sql`, `,
      )}]::text[]) AS t(table_name)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE has_table_privilege(r.role, 'public.' || t.table_name, 'SELECT, INSERT, UPDATE, DELETE')
    `)

    expect(rows).toEqual([])
  })

  it('refuses a crowd draw list to a signed-in user who queries it directly', async () => {
    const edition = await newEdition(20)
    const [a] = await addEntries(edition.id, 1)
    const [draw] = await db
      .insert(crowdDraws)
      .values({ editionId: edition.id, reason: 'selection', slots: 1 })
      .returning()
    await db
      .insert(crowdDrawTickets)
      .values({ editionId: edition.id, drawId: draw!.id, entryId: a!.id, number: 1 })

    await expect(
      asRole(
        'authenticated',
        userId,
        `SELECT * FROM crowd_draw_tickets WHERE edition_id = '${edition.id}'`,
      ),
    ).rejects.toThrow()
  })

  it('rejects direct writes', async () => {
    await expect(
      asRole(
        'authenticated',
        userId,
        `INSERT INTO leagues (name, slug) VALUES ('x', 'rls-${run}')`,
      ),
    ).rejects.toThrow()
    await expect(
      asRole(
        'authenticated',
        userId,
        `INSERT INTO vulgos (name, slug) VALUES ('x', 'rls-vulgo-${run}')`,
      ),
    ).rejects.toThrow()
  })
})
