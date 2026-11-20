import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '@/shared/db/client'
import { leagues, vulgos } from '@/shared/db/schema'
import { cleanupAuthUser } from '@/shared/db/test-helpers'
import type { BattleId, EditionId, LeagueId } from '@/shared/lib/ids'

import type * as AuthModule from '@/modules/auth'
import type { User } from '@/modules/auth'
import { requestVulgoClaim } from '@/modules/mcs'

import { actAs, createAccount, createGuestAccount, requireUserMock } from './act-as.test-helper'

import {
  addEntry,
  addLeagueOrganizer,
  cancelEdition,
  closeRegistration,
  createEdition,
  createLeague,
  decideVulgoClaim,
  getCrowdDraws,
  getEditionDetails,
  getMcPage,
  getMyDashboard,
  getVulgoPage,
  listClaimsToReview,
  listLeagueEditions,
  listLeagueOrganizers,
  listMyLeagues,
  moveEntry,
  recordRound,
  redrawBracket,
  removeEntry,
  removeLeagueOrganizer,
  reopenRegistration,
  submitCrowdDrawPicks,
  undoLastRound,
  withdrawMc,
} from './index'

vi.mock('@/modules/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireUser: () => requireUserMock(),
}))

// ─── helpers ───────────────────────────────────────────────────────────

type AnyResult = { ok: true; value: unknown } | { ok: false; error: { code: string } }

function unwrap<R extends AnyResult>(result: R): Extract<R, { ok: true }>['value'] {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value as Extract<R, { ok: true }>['value']
}

const code = (result: AnyResult) => (result.ok ? null : result.error.code)

const run = randomUUID().slice(0, 8)
const users: User[] = []
const leagueIds: LeagueId[] = []

async function account(name: string, role: User['role'] = 'user') {
  const user = await createAccount(name, role)
  users.push(user)
  return user
}

let admin: User
let organizer: User

async function newLeague() {
  actAs(admin)
  const league = unwrap(await createLeague({ name: `Batalha ${run} ${randomUUID().slice(0, 4)}` }))
  leagueIds.push(league.id)
  unwrap(await addLeagueOrganizer({ leagueId: league.id, login: organizer.email }))
  return league
}

/** A new edition with `count` names (MC <run> <tag> 1..count), as the organizer. */
async function newNight(count: number, tag = randomUUID().slice(0, 4)) {
  const league = await newLeague()
  actAs(organizer)
  const edition = unwrap(await createEdition({ leagueId: league.id, eventDate: '2026-11-14' }))
  const entries = []
  for (let n = 1; n <= count; n++) {
    entries.push(
      unwrap(await addEntry({ editionId: edition.id, vulgoName: `MC ${run} ${tag} ${n}` })),
    )
  }
  return { league, edition, entries }
}

async function details(editionId: EditionId) {
  const found = await getEditionDetails(editionId)
  if (!found) throw new Error('edition not found')
  return found
}

const playable = (d: Awaited<ReturnType<typeof details>>) =>
  d.bracket.flatMap((p) => p.battles).filter((b) => b.state === 'ready' || b.state === 'live')

/** Plays a battle 2-0 for slot A. */
async function winA(battleId: BattleId) {
  unwrap(await recordRound({ battleId, votesA: 60, votesB: 40 }))
  return unwrap(await recordRound({ battleId, votesA: 55, votesB: 45 }))
}

/** Plays every ready battle until the edition is completed. */
async function playOut(editionId: EditionId) {
  for (let guard = 0; guard < 20; guard++) {
    const d = await details(editionId)
    if (d.edition.status === 'completed') return d
    const [next] = playable(d)
    if (!next) throw new Error('nothing playable but the edition is not completed')
    await winA(next.id)
  }
  throw new Error('edition never completed')
}

beforeAll(async () => {
  admin = await account(`Admin ${run}`, 'admin')
  organizer = await account(`Organizer ${run}`)
})

afterEach(() => actAs(null))

afterAll(async () => {
  if (leagueIds.length > 0) await db.delete(leagues).where(inArray(leagues.id, leagueIds))
  const creators = users.map((u) => u.id)
  await db.delete(vulgos).where(inArray(vulgos.createdBy, creators))
  for (const user of users) await cleanupAuthUser(user.id)
})

// ─── roles ─────────────────────────────────────────────────────────────

describe('roles (spec: Roles)', () => {
  it('lets only admins create leagues and manage organizers', async () => {
    const mc = await account(`Plain MC ${run}`)
    actAs(mc)
    expect(code(await createLeague({ name: 'Nope' }))).toBe('FORBIDDEN')

    const league = await newLeague()
    actAs(mc)
    expect(code(await addLeagueOrganizer({ leagueId: league.id, login: mc.email }))).toBe(
      'FORBIDDEN',
    )

    actAs(admin)
    expect(code(await addLeagueOrganizer({ leagueId: league.id, login: organizer.email }))).toBe(
      'CONFLICT',
    )
    expect(
      code(await addLeagueOrganizer({ leagueId: league.id, login: `ghost-${run}@x.test` })),
    ).toBe('NOT_FOUND')
  })

  it('adds a guest MC as organizer by nickname and never shows the guest address', async () => {
    const guest = await createGuestAccount(`g${run}`)
    users.push(guest)
    const league = await newLeague()

    actAs(admin)
    expect(code(await addLeagueOrganizer({ leagueId: league.id, login: guest.email }))).toBe(
      'VALIDATION_ERROR',
    )
    const added = unwrap(
      await addLeagueOrganizer({ leagueId: league.id, login: guest.guestNickname! }),
    )
    expect(added).toMatchObject({ userId: guest.id, name: guest.guestNickname, email: null })

    const listed = unwrap(await listLeagueOrganizers(league.id))
    expect(listed.find((o) => o.userId === guest.id)).toMatchObject({
      name: guest.guestNickname,
      email: null,
    })
    expect(JSON.stringify(listed)).not.toContain('@guest.invalid')

    // Every account is an MC: the nickname becomes the guest's first vulgo.
    actAs(guest)
    expect(unwrap(await getMyDashboard()).vulgos.map((v) => v.name)).toEqual([guest.guestNickname])
  })

  it('lets organizers run their league only, until an admin removes them', async () => {
    const league = await newLeague()
    const other = await account(`Other organizer ${run}`)

    actAs(organizer)
    expect(
      unwrap(await createEdition({ leagueId: league.id, eventDate: '2026-11-14' })).number,
    ).toBe(1)
    expect(
      unwrap(await createEdition({ leagueId: league.id, eventDate: '2026-11-21' })).number,
    ).toBe(2)
    expect(unwrap(await listMyLeagues()).map((l) => l.id)).toContain(league.id)
    expect(unwrap(await listLeagueOrganizers(league.id)).map((o) => o.email)).toEqual([
      organizer.email,
    ])

    actAs(other)
    expect(code(await createEdition({ leagueId: league.id, eventDate: '2026-11-14' }))).toBe(
      'FORBIDDEN',
    )
    expect(code(await listLeagueOrganizers(league.id))).toBe('FORBIDDEN')

    actAs(admin)
    expect(unwrap(await listMyLeagues()).map((l) => l.id)).toContain(league.id)
    unwrap(await removeLeagueOrganizer({ leagueId: league.id, userId: organizer.id }))
    actAs(organizer)
    expect(code(await createEdition({ leagueId: league.id, eventDate: '2026-11-14' }))).toBe(
      'FORBIDDEN',
    )
  })
})

// ─── registration ─────────────────────────────────────────────────────

describe('registration (spec: step 1)', () => {
  it('numbers names by arrival, reuses vulgos and lets the order be fixed', async () => {
    const { edition, entries } = await newNight(5, 'reg')
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5])

    // Same vulgo, different accents/case: already on the list.
    expect(code(await addEntry({ editionId: edition.id, vulgoName: `mc ${run} REG 3` }))).toBe(
      'CONFLICT',
    )

    // Picked from autocomplete by id in another league's night works too.
    const next = await newNight(0, 'reg-other')
    actAs(organizer)
    const reused = unwrap(
      await addEntry({ editionId: next.edition.id, vulgoId: entries[0]!.vulgo.id }),
    )
    expect(reused.vulgo.id).toBe(entries[0]!.vulgo.id)

    const moved = unwrap(await moveEntry({ entryId: entries[4]!.id, toNumber: 2 }))
    expect(moved.map((e) => e.id)).toEqual([0, 4, 1, 2, 3].map((i) => entries[i]!.id))
    expect(moved.map((e) => e.number)).toEqual([1, 2, 3, 4, 5])

    const removed = unwrap(await removeEntry({ entryId: entries[1]!.id }))
    expect(removed.map((e) => e.number)).toEqual([1, 2, 3, 4])
    expect(removed.some((e) => e.id === entries[1]!.id)).toBe(false)

    expect(code(await closeRegistration({ editionId: edition.id }))).toBe('CONFLICT')
  })
})

// ─── selection ─────────────────────────────────────────────────────────

describe('selection (spec: step 2)', () => {
  it('10 names: first 6 by arrival, 2 from a secret crowd draw, then the bracket', async () => {
    const { edition, entries } = await newNight(10, 'sel')

    const closed = unwrap(await closeRegistration({ editionId: edition.id }))
    expect(closed.edition).toMatchObject({ status: 'selection', bracketSize: 8 })
    const draw = closed.crowdDraw!
    expect(draw).toMatchObject({ reason: 'selection', slots: 2 })
    expect(draw.tickets.map((t) => t.number)).toEqual([1, 2, 3, 4])
    // The pool is arrivals #7..#10, numbered independently of arrival.
    expect(draw.tickets.map((t) => t.entryId).sort()).toEqual(
      entries
        .slice(6)
        .map((e) => e.id)
        .sort(),
    )

    let d = await details(edition.id)
    expect(
      d.entries.slice(0, 6).every((e) => e.status === 'selected' && e.selectedBy === 'arrival'),
    ).toBe(true)
    expect(d.pendingDraw).toEqual({ reason: 'selection', slots: 2, range: 4 })
    expect(JSON.stringify(d)).not.toContain('tickets')

    // The number -> vulgo list: organizers yes, anyone else no.
    const organizerView = unwrap(await getCrowdDraws(edition.id))
    expect(organizerView[0]!.tickets.every((t) => t.vulgo !== null)).toBe(true)
    actAs(await account(`Curious MC ${run}`))
    expect(code(await getCrowdDraws(edition.id))).toBe('FORBIDDEN')
    actAs(organizer)

    expect(code(await submitCrowdDrawPicks({ drawId: draw.id, numbers: [1] }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(code(await submitCrowdDrawPicks({ drawId: draw.id, numbers: [1, 5] }))).toBe(
      'VALIDATION_ERROR',
    )
    unwrap(await submitCrowdDrawPicks({ drawId: draw.id, numbers: [4, 2] }))
    expect(code(await submitCrowdDrawPicks({ drawId: draw.id, numbers: [1, 3] }))).toBe('CONFLICT')

    d = await details(edition.id)
    const picked = new Set([draw.tickets[3]!.entryId, draw.tickets[1]!.entryId])
    expect(d.edition.status).toBe('in_progress')
    expect(d.pendingDraw).toBeNull()
    for (const entry of d.entries.slice(6)) {
      expect(entry.status).toBe(picked.has(entry.id) ? 'selected' : 'not_selected')
      expect(entry.outcome.result).toBe(picked.has(entry.id) ? 'in_contention' : 'not_selected')
    }
    const firstPhase = d.bracket[0]!.battles
    expect(d.bracket.map((p) => p.stage)).toEqual(['quarterfinal', 'semifinal', 'final'])
    expect(firstPhase.flatMap((b) => [b.entryAId, b.entryBId]).sort()).toEqual(
      d.entries
        .filter((e) => e.status === 'selected')
        .map((e) => e.id)
        .sort(),
    )
    expect(code(await addEntry({ editionId: edition.id, vulgoName: 'Late' }))).toBe('CONFLICT')
  })

  it('can reopen the list before the crowd picks', async () => {
    const { edition } = await newNight(9, 'reopen')
    unwrap(await closeRegistration({ editionId: edition.id }))
    const reopened = unwrap(await reopenRegistration({ editionId: edition.id }))
    expect(reopened).toMatchObject({ status: 'registration', bracketSize: null })
    const d = await details(edition.id)
    expect(d.entries.every((e) => e.status === 'registered')).toBe(true)
    expect(d.pendingDraw).toBeNull()
    unwrap(await addEntry({ editionId: edition.id, vulgoName: `MC ${run} reopen late` }))
    const again = unwrap(await closeRegistration({ editionId: edition.id }))
    expect(again.crowdDraw!.tickets).toHaveLength(4)
  })

  it.each([
    [8, { bracketSize: 8, status: 'in_progress', battles: 7, draw: null }],
    [16, { bracketSize: 16, status: 'in_progress', battles: 15, draw: null }],
    [17, { bracketSize: 16, status: 'selection', battles: 0, draw: { slots: 4, range: 5 } }],
  ])('%i names -> %o', async (count, expected) => {
    const { edition } = await newNight(count)
    const closed = unwrap(await closeRegistration({ editionId: edition.id }))
    expect({
      bracketSize: closed.edition.bracketSize,
      status: closed.edition.status,
      battles: closed.battles.length,
      draw: closed.crowdDraw
        ? { slots: closed.crowdDraw.slots, range: closed.crowdDraw.tickets.length }
        : null,
    }).toEqual(expected)
  })
})

// ─── battles ───────────────────────────────────────────────────────────

describe('battles (spec: steps 3–4)', () => {
  it('runs the bracket round by round, crowns the champion and writes history', async () => {
    const { edition } = await newNight(8, 'play')
    unwrap(await closeRegistration({ editionId: edition.id }))

    // Pairing can be redrawn until the first round.
    unwrap(await redrawBracket({ editionId: edition.id }))

    let d = await details(edition.id)
    const opener = d.bracket[0]!.battles[0]!
    expect(code(await recordRound({ battleId: opener.id, votesA: 30, votesB: 30 }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(
      code(await recordRound({ battleId: d.bracket[1]!.battles[0]!.id, votesA: 3, votesB: 1 })),
    ).toBe('CONFLICT')

    // 1-1, then a third round decides.
    unwrap(await recordRound({ battleId: opener.id, votesA: 52, votesB: 48 }))
    expect(code(await redrawBracket({ editionId: edition.id }))).toBe('CONFLICT')
    unwrap(await recordRound({ battleId: opener.id, votesA: 40, votesB: 60 }))
    const decided = unwrap(await recordRound({ battleId: opener.id, votesA: 10, votesB: 90 }))
    expect(decided.battle.winnerEntryId).toBe(opener.entryBId)

    d = await details(edition.id)
    const openerView = d.bracket[0]!.battles[0]!
    expect(openerView).toMatchObject({ state: 'decided', winsA: 1, winsB: 2, walkover: false })
    expect(openerView.rounds.map((r) => [r.roundNo, r.votesA, r.votesB, r.recordedBy])).toEqual([
      [1, 52, 48, organizer.name],
      [2, 40, 60, organizer.name],
      [3, 10, 90, organizer.name],
    ])
    expect(d.bracket[1]!.battles[0]!.entryAId).toBe(opener.entryBId)

    const finished = await playOut(edition.id)
    expect(finished.edition.status).toBe('completed')
    const final = finished.bracket.at(-1)!.battles[0]!
    expect(finished.champion?.id).toBe(final.mcA?.id)

    // Undoing the final reopens the night; recording again completes it.
    const undone = unwrap(await undoLastRound({ battleId: final.id }))
    expect(undone.edition.status).toBe('in_progress')
    const semi = finished.bracket[1]!.battles[0]!
    expect(code(await undoLastRound({ battleId: semi.id }))).toBe('CONFLICT')
    unwrap(await recordRound({ battleId: final.id, votesA: 1, votesB: 99 }))
    unwrap(await recordRound({ battleId: final.id, votesA: 2, votesB: 98 }))
    const recrowned = await details(edition.id)
    expect(recrowned.edition.status).toBe('completed')
    expect(recrowned.champion?.id).toBe(final.mcB?.id)

    // History speaks the spec's language.
    const outcomes = Object.fromEntries(
      recrowned.entries.map((e) => [e.id, e.outcome.result] as const),
    )
    expect(Object.values(outcomes).sort()).toEqual([
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
      'runner_up',
      'won',
    ])
    const champion = (await getVulgoPage(recrowned.champion!.slug))!
    expect(champion.history[0]).toMatchObject({ outcome: { result: 'won' } })
    expect(champion.history[0]!.battles.map((b) => b.stage)).toEqual([
      'quarterfinal',
      'semifinal',
      'final',
    ])
    const openerLoser = (await getVulgoPage(openerView.mcA!.slug))!
    expect(openerLoser.history[0]).toMatchObject({
      outcome: { result: 'eliminated', stage: 'quarterfinal' },
    })
    expect(openerLoser.history[0]!.battles[0]!.rounds).toEqual([
      { roundNo: 1, votesFor: 52, votesAgainst: 48 },
      { roundNo: 2, votesFor: 40, votesAgainst: 60 },
      { roundNo: 3, votesFor: 10, votesAgainst: 90 },
    ])
  })

  it('serializes concurrent results from several organizers', async () => {
    const { edition } = await newNight(8, 'concurrent')
    unwrap(await closeRegistration({ editionId: edition.id }))
    const quarters = (await details(edition.id)).bracket[0]!.battles
    const results = await Promise.all(
      quarters.map((b) => recordRound({ battleId: b.id, votesA: 10, votesB: 20 })),
    )
    results.forEach((r) => unwrap(r))
    const again = await Promise.all(
      quarters.map((b) => recordRound({ battleId: b.id, votesA: 10, votesB: 20 })),
    )
    again.forEach((r) => unwrap(r))
    const semis = (await details(edition.id)).bracket[1]!.battles
    expect(semis.flatMap((b) => [b.entryAId, b.entryBId]).sort()).toEqual(
      quarters.map((b) => b.entryBId).sort(),
    )
  })

  it('keeps cancelled nights out of history', async () => {
    const { edition, entries } = await newNight(8, 'cancel')
    unwrap(await closeRegistration({ editionId: edition.id }))
    unwrap(await cancelEdition({ editionId: edition.id }))
    expect(code(await cancelEdition({ editionId: edition.id }))).toBe('CONFLICT')
    const page = (await getVulgoPage(entries[0]!.vulgo.slug))!
    expect(page.history).toHaveLength(0)
  })
})

// ─── withdrawals ───────────────────────────────────────────────────────

describe('withdrawals (spec: step 5)', () => {
  async function liveNightWithPool() {
    const night = await newNight(10)
    const closed = unwrap(await closeRegistration({ editionId: night.edition.id }))
    unwrap(await submitCrowdDrawPicks({ drawId: closed.crowdDraw!.id, numbers: [1, 2] }))
    return night
  }

  it('before their first battle: new crowd draw among the non-selected', async () => {
    const { edition } = await liveNightWithPool()
    const opener = (await details(edition.id)).bracket[0]!.battles[0]!

    const withdrawn = unwrap(await withdrawMc({ entryId: opener.entryAId! }))
    expect(withdrawn.withdrawal.method).toBe('crowd_draw')
    expect(withdrawn.crowdDraw).toMatchObject({ reason: 'replacement', slots: 1 })
    expect(withdrawn.crowdDraw!.tickets).toHaveLength(2)

    let d = await details(edition.id)
    expect(d.pendingDraw).toEqual({ reason: 'replacement', slots: 1, range: 2 })
    expect(d.bracket[0]!.battles[0]!.state).toBe('awaiting_replacement')
    expect(code(await recordRound({ battleId: opener.id, votesA: 2, votesB: 1 }))).toBe('CONFLICT')

    unwrap(await submitCrowdDrawPicks({ drawId: withdrawn.crowdDraw!.id, numbers: [2] }))
    const replacement = withdrawn.crowdDraw!.tickets[1]!.entryId
    d = await details(edition.id)
    expect(d.bracket[0]!.battles[0]).toMatchObject({ entryAId: replacement, state: 'ready' })
    expect(d.entries.find((e) => e.id === replacement)).toMatchObject({
      status: 'selected',
      selectedBy: 'replacement',
    })
    expect(d.entries.find((e) => e.id === opener.entryAId)!.outcome).toEqual({ result: 'withdrew' })
    expect(d.withdrawals[0]).toMatchObject({
      method: 'crowd_draw',
      replacementEntryId: replacement,
    })
  })

  it('after winning: the MC they beat takes their place', async () => {
    const { edition } = await liveNightWithPool()
    const [first, second] = (await details(edition.id)).bracket[0]!.battles
    await winA(first!.id)
    await winA(second!.id)

    const withdrawn = unwrap(await withdrawMc({ entryId: first!.entryAId! }))
    expect(withdrawn.withdrawal).toMatchObject({
      method: 'previous_opponent',
      replacementEntryId: first!.entryBId,
    })
    const semi = (await details(edition.id)).bracket[1]!.battles[0]!
    expect(semi).toMatchObject({
      entryAId: first!.entryBId,
      entryBId: second!.entryAId,
      state: 'ready',
    })

    // The returning MC is judged by the battle they replaced into.
    await winA(semi.id)
    const d = await details(edition.id)
    expect(d.entries.find((e) => e.id === first!.entryBId)!.outcome.result).toBe('in_contention')
  })

  it('mid-battle, or with nobody left to draw: walkover', async () => {
    const { edition } = await liveNightWithPool()
    const opener = (await details(edition.id)).bracket[0]!.battles[0]!
    unwrap(await recordRound({ battleId: opener.id, votesA: 70, votesB: 30 }))
    const midBattle = unwrap(await withdrawMc({ entryId: opener.entryAId! }))
    expect(midBattle.withdrawal.method).toBe('walkover')
    let d = await details(edition.id)
    expect(d.bracket[0]!.battles[0]).toMatchObject({
      winnerEntryId: opener.entryBId,
      state: 'decided',
    })
    expect(d.bracket[1]!.battles[0]!.entryAId).toBe(opener.entryBId)

    const exact = await newNight(8, 'no-pool')
    unwrap(await closeRegistration({ editionId: exact.edition.id }))
    const first = (await details(exact.edition.id)).bracket[0]!.battles[0]!
    const noPool = unwrap(await withdrawMc({ entryId: first.entryBId! }))
    expect(noPool.withdrawal.method).toBe('walkover')
    d = await details(exact.edition.id)
    expect(d.bracket[0]!.battles[0]!).toMatchObject({
      winnerEntryId: first.entryAId,
      walkover: true,
    })
    expect(code(await undoLastRound({ battleId: first.id }))).toBe('CONFLICT')
  })

  it('a walkover in the final completes the night', async () => {
    const { edition } = await newNight(8, 'final-wo')
    unwrap(await closeRegistration({ editionId: edition.id }))
    let final = playable(await details(edition.id)).find((b) => b.phase === 3)
    while (!final) {
      await winA(playable(await details(edition.id))[0]!.id)
      final = playable(await details(edition.id)).find((b) => b.phase === 3)
    }

    // Before the final, the semifinal loser would replace them; after a
    // round has been recorded it is a walkover.
    unwrap(await recordRound({ battleId: final.id, votesA: 80, votesB: 20 }))
    const done = unwrap(await withdrawMc({ entryId: final.entryAId! }))
    expect(done.withdrawal.method).toBe('walkover')
    expect(done.edition.status).toBe('completed')
    expect((await details(edition.id)).champion?.id).toBe(final.mcB?.id)
  })
})

// ─── MC identity, claims, dashboard ───────────────────────────────────

describe('vulgos, claims and the MC dashboard (spec: Vulgos and profiles)', () => {
  it('hands over a battled vulgo only through an approved claim', async () => {
    const vulgoName = `Neguinho ${run}`
    const { league, edition } = await newNight(7, 'claim')
    actAs(organizer)
    unwrap(await addEntry({ editionId: edition.id, vulgoName }))
    unwrap(await closeRegistration({ editionId: edition.id }))
    await playOut(edition.id)

    // The real Neguinho signs up with that name: no free ride, a pending claim.
    const neguinho = await account(vulgoName)
    actAs(neguinho)
    let dashboard = unwrap(await getMyDashboard())
    expect(dashboard.vulgos).toHaveLength(0)
    expect(dashboard.claims).toMatchObject([{ status: 'pending', vulgo: { name: vulgoName } }])
    expect(dashboard.history).toHaveLength(0)
    // An impostor asks for the same vulgo.
    const impostor = await account(`Impostor ${run}`)
    actAs(impostor)
    const impostorClaim = unwrap(await requestVulgoClaim({ vulgoId: dashboard.claims[0]!.vulgoId }))
    expect(code(await requestVulgoClaim({ vulgoId: dashboard.claims[0]!.vulgoId }))).toBe(
      'CONFLICT',
    )

    // Organizers of unrelated leagues can neither see nor decide it.
    const outsider = await account(`Outsider organizer ${run}`)
    actAs(admin)
    const elsewhere = unwrap(await createLeague({ name: `Elsewhere ${run}` }))
    leagueIds.push(elsewhere.id)
    unwrap(await addLeagueOrganizer({ leagueId: elsewhere.id, login: outsider.email }))
    actAs(outsider)
    expect(unwrap(await listClaimsToReview())).toHaveLength(0)
    expect(
      code(await decideVulgoClaim({ claimId: dashboard.claims[0]!.id, decision: 'approved' })),
    ).toBe('FORBIDDEN')

    // The league's organizer sees both and approves the real one.
    actAs(organizer)
    const toReview = unwrap(await listClaimsToReview())
    expect(toReview.map((c) => c.claimantName).sort()).toEqual(
      [`Impostor ${run}`, vulgoName].sort(),
    )
    unwrap(await decideVulgoClaim({ claimId: dashboard.claims[0]!.id, decision: 'approved' }))
    expect(code(await decideVulgoClaim({ claimId: impostorClaim.id, decision: 'approved' }))).toBe(
      'CONFLICT',
    )

    actAs(neguinho)
    dashboard = unwrap(await getMyDashboard())
    expect(dashboard.vulgos.map((v) => v.name)).toEqual([vulgoName])
    expect(dashboard.history).toHaveLength(1)
    expect(dashboard.history[0]).toMatchObject({
      league: { id: league.id },
      edition: { id: edition.id },
      arrivalNumber: 8,
    })
    expect(dashboard.history[0]!.outcome.result).not.toBe('registered')

    actAs(impostor)
    const impostorView = unwrap(await getMyDashboard())
    expect(impostorView.claims.find((c) => c.id === impostorClaim.id)?.status).toBe('rejected')

    // Public pages follow the owner.
    const page = (await getMcPage(dashboard.profile.slug))!
    expect(page.vulgos.map((v) => v.ownerProfileSlug)).toEqual([dashboard.profile.slug])
    expect(page.history).toHaveLength(1)
    const vulgoPage = (await getVulgoPage(page.vulgos[0]!.slug))!
    expect(vulgoPage.vulgo.ownerProfileSlug).toBe(dashboard.profile.slug)
  })

  it('gives a brand-new name to the MC right away, and dashboards are idempotent', async () => {
    const fresh = await account(`Fresh MC ${run}`)
    actAs(fresh)
    const [first, second] = await Promise.all([getMyDashboard(), getMyDashboard()])
    expect(unwrap(first).profile.id).toBe(unwrap(second).profile.id)
    expect(unwrap(first).vulgos.map((v) => v.name)).toEqual([`Fresh MC ${run}`])
    expect(unwrap(first).claims).toHaveLength(0)
    expect(code(await requestVulgoClaim({ vulgoId: unwrap(first).vulgos[0]!.id }))).toBe('CONFLICT')
  })
})

describe('public league listing', () => {
  it('lists a league editions newest first with entry counts', async () => {
    const { league } = await newNight(3)
    actAs(organizer)
    unwrap(await createEdition({ leagueId: league.id, eventDate: '2026-12-05' }))
    const page = await listLeagueEditions(league.id, { perPage: 10 })
    expect(page.total).toBe(2)
    expect(page.items.map((e) => [e.number, e.entryCount])).toEqual([
      [2, 0],
      [1, 3],
    ])
    expect((await db.select().from(leagues).where(eq(leagues.id, league.id))).length).toBe(1)
  })
})
