# Known bugs

Bugs found and confirmed but **not fixed yet**. Each entry documents the bug and does not change behavior. A fix goes through the normal workflow (`CLAUDE.md`, "Required workflow").

| ID                                                                                              | Title                                                                          | Severity | Status |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------ |
| [KB-001](#kb-001-a-withdrawal-brings-back-an-mc-who-already-withdrew-and-the-battle-gets-stuck) | A withdrawal brings back an MC who already withdrew, and the battle gets stuck | High     | Open   |

---

## KB-001: a withdrawal brings back an MC who already withdrew, and the battle gets stuck

| Field        | Value                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity     | **High**. The edition gets stuck; the only thing an organizer can do is cancel the whole night.                                                              |
| Likelihood   | Low. It takes two withdrawals in the same branch of the bracket. Withdrawals are "exceptional" per the spec, but on a long night this is plausible.          |
| Where        | `src/modules/leagues/domain/withdrawal.ts`, `planWithdrawal`, lines 76–88                                                                                    |
| Confirmed on | `main` at `04d3216` (2026-11-21)                                                                                                                             |
| Found        | 2026-11-20, manual testing of a local copy of the original leagues delivery. Its `withdrawal.ts` and `record-round.handler.ts` are identical to this repo's. |
| Status       | Open. A fix is proposed and was validated (see below), **not applied**.                                                                                      |

### Summary

When an MC withdraws **after winning a battle**, the rule brings back "the MC they beat most recently". The code does not check whether that MC is still available. If that last win was a **walkover** (the opponent had withdrawn), the MC brought back is exactly the one who already withdrew. The next battle then has an unavailable MC on one side, goes to `awaiting_replacement`, and **no organizer action can unblock it**.

### What the spec says

`docs/mvp-spec.md`, _Battle night → Withdrawals_:

> - After winning at least one battle: the MC they beat most recently takes their place.
> - **Not coverable (nobody left to draw, or they leave mid-battle after a round was recorded): the opponent advances by walkover.**

An MC who already withdrew cannot cover anyone, so this case is _not coverable_: the opponent should advance by walkover.

### Steps to reproduce

There is no organizer UI yet, so these are the server actions an organizer screen would call (`@/modules/leagues`).

**Scenario A: 8 names, so nobody is left to draw**

1. `createEdition`, then `addEntry` × 8, then `closeRegistration`. The bracket is drawn right away.
2. Quarterfinal 1 is **A × B**. Before any round is recorded, call `withdrawMc` for **B**. With nobody to draw, the result is `walkover` and **A** advances.
3. Play quarterfinal 2 (**C × D**) with `recordRound` until it has a winner, say **C**. The semifinal is now **A × C**.
4. Call `withdrawMc` for **A**.
5. Result: the method is `previous_opponent` and the semifinal becomes **B × C** in `awaiting_replacement`. **B** had already withdrawn in step 2.

**Scenario B: 9–15 names, so there is a crowd-draw pool**

Same as above, but in step 2 record **one round** of A × B first, then call `withdrawMc` for B. A mid-battle withdrawal is also a walkover, even when there are MCs left to draw. Steps 3–5 behave the same way.

**Unit-level reproduction** (no database). It asserts the spec behavior, so it **fails** today:

```ts
import { describe, expect, it } from 'vitest'

import { applyChanges, type Battle } from './bracket'
import { at, entry, entryId, orderedBracket } from './test-fixtures'
import { planWithdrawal } from './withdrawal'

/** Decides a battle of `orderedBracket` (1v2, 3v4, ...) and advances the winner. */
function decide(battles: Battle[], phase: number, position: number, winner: number): Battle[] {
  const battle = at(battles, phase, position)
  const slot = position % 2 === 1 ? 'entryAId' : 'entryBId'
  return applyChanges(battles, [
    { battleId: battle.id, set: { winnerEntryId: entryId(winner) } },
    ...(phase < 3
      ? [
          {
            battleId: at(battles, phase + 1, Math.ceil(position / 2)).id,
            set: { [slot]: entryId(winner) },
          },
        ]
      : []),
  ])
}

describe('planWithdrawal', () => {
  it('does not bring back an MC who already withdrew', () => {
    // QF: 2 withdrew before battling (nobody to draw) → 1 won by walkover. 3 beat 4.
    // SF: 1 × 3. Now 1 withdraws too.
    let battles = decide(orderedBracket(), 1, 1, 1)
    battles = decide(battles, 1, 2, 3)
    const entries = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => (n === 2 ? entry(2, 'withdrew') : entry(n)))

    const plan = planWithdrawal({ entry: entry(1), entries, battles, rounds: [] })

    if (!plan.ok) throw plan.error
    expect(plan.value).not.toMatchObject({ replacementEntryId: entryId(2) })
    expect(plan.value.method).toBe('walkover')
  })
})
```

Output on `main` (`04d3216`):

```
× does not bring back an MC who already withdrew
AssertionError: expected { method: 'previous_opponent', …(3) } to not match object { Object (replacementEntryId) }
```

### Actual vs expected

|                              | Actual (bug)                                                                  | Expected (spec)                                    |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Method of the 2nd withdrawal | `previous_opponent`                                                           | `walkover`                                         |
| Who takes the slot           | the MC who already withdrew (status `withdrew`)                               | nobody, the opponent advances                      |
| Battle state                 | `awaiting_replacement`, forever                                               | `decided` (walkover)                               |
| Pending crowd draw           | none (`pendingDraw = null`)                                                   | not applicable                                     |
| `withdrawals` row            | `method = previous_opponent`, `replacement_entry_id` = an MC who already left | `method = walkover`, `replacement_entry_id = null` |
| Can the night go on?         | **No**, only by cancelling the edition                                        | Yes                                                |

### Observed in a real run

In the manual test that found the bug (local data, 8-MC bracket), four quarterfinal withdrawals ended in walkovers. Then two quarterfinal winners withdrew before the semis:

| Order | Left                                                       | Method            | Replacement                          |
| ----- | ---------------------------------------------------------- | ----------------- | ------------------------------------ |
| 1–4   | four quarterfinalists, including **Gusta** and **Grafite** | walkover          | —                                    |
| 5     | Faísca, who beat Gusta by walkover                         | previous_opponent | **Gusta** ⚠️ had already withdrawn   |
| 6     | Zé Concreto, who beat Grafite by walkover                  | previous_opponent | **Grafite** ⚠️ had already withdrawn |

Both semifinals ended up as `selected × withdrew`, in `awaiting_replacement`, with `pendingDraw = null`. The edition was stuck in `in_progress`.

The automated reproduction of scenarios A and B against the real server actions and the local Supabase gave the same result: `previous_opponent`, then `awaiting_replacement` with `pendingDraw = null`.

### Root cause

`src/modules/leagues/domain/withdrawal.ts`:

```ts
76    const lastWin = battles
77      .filter((b) => b.winnerEntryId === entry.id)
78      .sort((a, b) => b.phase - a.phase)[0]
79    const beaten = lastWin ? opponentIn(lastWin, entry.id) : null
80    if (beaten) {                       // ← checks that it exists, not that it is still available
81      return ok({
82        method: 'previous_opponent',
83        battleId: current.id,
84        replacementEntryId: beaten,
85        changes: [replaceInBattle(current, entry.id, beaten)],
86      })
87    }
88    return walkover()
```

`lastWin` includes walkover wins. A walkover battle still holds the MC who withdrew in one of its slots, so `opponentIn(lastWin, …)` returns that MC. `input.entries`, with every entry's status, is already passed in but not used here.

### Why there is no way out

The bug writes a state that no action can undo:

| Organizer action                   | Result                                                          | Where                                                                                |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Record a round in the stuck battle | `CONFLICT: this battle is waiting for a replacement MC`         | `record-round.handler.ts:44-45` treats entries with status `withdrew` as unavailable |
| Withdraw the "replacement"         | `CONFLICT: only selected MCs still in the bracket can withdraw` | `withdrawal.ts:53-54` only accepts status `selected`                                 |
| Undo the last round                | not applicable, a walkover has no round to undo                 | `bracket.test.ts:207` ("refuses … including walkovers")                              |
| Redraw the bracket                 | not allowed after the first round                               | spec, step 3                                                                         |
| Submit crowd-draw picks            | there is no pending draw                                        | `pendingDraw = null`                                                                 |
| Cancel the edition                 | works                                                           | **the only way out**, and the night is lost                                          |

`awaiting_replacement` (`bracket.ts:244-255`) is meant for "waiting for a replacement crowd draw". Here it shows up with no draw at all, so nothing resolves it.

### Why the existing tests miss it

The `previous_opponent` tests only use regular wins, decided by rounds:

- `withdrawal.test.ts`: _"replaces a winner who leaves with the MC they beat most recently"_ and _"uses the most recent win when the leaver won several battles"_. The beaten MCs keep status `selected` in both.
- `battle-night.integration.test.ts`: _"after winning: the MC they beat takes their place"_ uses `winA`, a win with rounds.

No test combines **a walkover followed by the winner withdrawing**, so the whole suite passes with the bug present.

### Impact

- **During the night:** the organizer cannot continue the bracket. They either cancel the edition in front of the crowd or carry on outside the app.
- **Public pages and stream overlays:** the battle shows "waiting for a replacement" forever.
- **History:** the `withdrawals` row says `previous_opponent` with a replacement who already left, which is inconsistent. If the edition is cancelled, the whole night's history becomes a cancelled edition's.
- **Existing data:** the fix below prevents **new** cases. It does not unblock editions that are already stuck (see "Data repair").

### Proposed fix (not applied)

Bring back the beaten MC only if they are still in the bracket. Otherwise fall through to the walkover the spec calls for:

```diff
   const beaten = lastWin ? opponentIn(lastWin, entry.id) : null
-  if (beaten) {
+  const stillAvailable = (id: EntryId) =>
+    input.entries.some((e) => e.id === id && e.status === 'selected')
+  if (beaten && stillAvailable(beaten)) {
     return ok({
       method: 'previous_opponent',
```

**Validation.** The change was applied temporarily to the local copy of the original delivery and then reverted. That copy's `withdrawal.ts` is identical to this repo's; its test suite is not, since this repo also has the guest-account work.

| Check                           | Result with the fix                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Unit reproduction above         | ✓ passes (method becomes `walkover`)                                               |
| Scenario A, real server actions | ✓ passes: the semifinal is decided by walkover for the other quarterfinal's winner |
| Scenario B, real server actions | ✓ passes                                                                           |
| That copy's unit suite          | ✓ 175/175                                                                          |
| That copy's integration suite   | ✓ 84/84                                                                            |
| `tsc --noEmit`                  | ✓                                                                                  |

**Not run yet in this repo with the fix.** When fixing, follow `/wc-tdd`: the unit reproduction above is the RED test, and scenarios A and B belong in `battle-night.integration.test.ts`.

### Open product question

The fix above follows the spec literally: if the most recently beaten MC is unavailable, it is a walkover. A reasonable alternative is to **walk back through the bracket** and bring back an MC beaten **earlier** who is still available.

Example: A beat X in the quarterfinal with rounds, then beat Y in the semifinal by walkover. Before the final, A withdraws. With the literal fix, A's opponent wins the edition by walkover. With the alternative, X returns for the final.

The spec does not cover this case. It needs a decision, recorded in `docs/mvp-spec.md`, before the fix.

### Data repair (editions already stuck)

There is no action for this today. The options are:

1. **Cancel the edition.** Simple, but the night is recorded as cancelled.
2. **A one-off repair script**, to run after the fix. For each stuck battle:
   1. take the unavailable MC out of the slot;
   2. decide the battle by walkover for the other side;
   3. advance the winner to the next phase;
   4. update the matching `withdrawals` row to `method = 'walkover'` and `replacement_entry_id = null`.

   It should use the domain's own functions (`decideChanges`, `applyBattleChanges`) rather than raw SQL, so the bracket advances by the same rules. **No such script exists yet.**
