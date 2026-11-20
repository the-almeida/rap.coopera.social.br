# MVP spec: battle leagues

Status: **approved**. This is the reference for the data model, permissions and
battle-night workflow. Change it before changing the behavior it describes.

## Roles

|                                                                                         | Admin | Organizer (per league)               | MC (every account) | Public |
| --------------------------------------------------------------------------------------- | ----- | ------------------------------------ | ------------------ | ------ |
| Create leagues; add/remove a league's organizers                                        | ✓     |                                      |                    |        |
| Run editions (names, selection, crowd draws, bracket, rounds, withdrawals, corrections) | ✓     | ✓                                    |                    |        |
| See crowd draw lists                                                                    | ✓     | ✓                                    |                    |        |
| Approve/reject vulgo claims                                                             | ✓     | ✓ (leagues where that vulgo battled) |                    |        |
| Request ownership of a vulgo                                                            |       |                                      | ✓                  |        |
| See own history on the dashboard                                                        |       |                                      | ✓                  |        |
| View leagues, editions, entry lists, brackets, results, history                         | ✓     | ✓                                    | ✓                  | ✓      |

- Every account is an MC. Its sign-up name becomes its first vulgo; for a guest account (nickname and password, no email) that is the nickname.
- Admins add an organizer by the account's email, or by the nickname of a guest account. A guest account's address is never shown.
- Admin is the platform-level organizer: creates leagues and adds organizers to them.
- Organizers are MCs an admin added to a league. All organizers of a league are equals (no owner).
- Organizers may battle in their own league and record their own results (the community audits live); every round stores who recorded it.

## Battle night

1. **Registration.** The organizer types vulgos (autocomplete over the whole platform; new names are created on the fly). Each entry gets a number: its arrival position. The organizer can reorder or remove entries.
2. **Selection.** At least 8 names are required. Valid bracket sizes are 8 and 16 (16 is the maximum).

   | Names | Bracket | Selected by arrival | Crowd draw |
   | ----- | ------- | ------------------- | ---------- |
   | 8     | 8       | all                 | none       |
   | 9–15  | 8       | first 6             | 2          |
   | 16    | 16      | all                 | none       |
   | 17+   | 16      | first 12            | 4          |

   Crowd draw: the backend assigns the remaining MCs **random numbers 1..X** (not their arrival numbers, to avoid bias). Only organizers/admins ever see this list. The organizer announces the range, the crowd calls out numbers, the organizer enters the picks, and selection is done.

3. **Bracket.** The app pairs the selected MCs at random. The organizer can redraw until the first round is recorded.
4. **Battles.** Two rounds, plus a third at 1-1; first to two round wins takes the battle. Same structure in every phase, final included. After each round the organizer enters both crowd vote counts. Ties never happen (the organizer casts the tiebreaker vote), so tied counts are rejected. The battle winner advances automatically; undoing the last round fixes a mistake.
5. **Withdrawals** (exceptional):
   - Before their first battle: new crowd draw (fresh random numbers) among the MCs still not selected; the picked MC takes the slot.
   - After winning at least one battle: the MC they beat most recently takes their place.
   - Not coverable (nobody left to draw, or they leave mid-battle after a round was recorded): the opponent advances by walkover.
   - The leaver's history shows "withdrew".
6. **Completed** when the final is decided. An edition can be cancelled any time before that.

History phrases: "not selected", "withdrew", "lost in the round of 16 / quarterfinals / semifinal", "runner-up", "won the edition".

## Vulgos and profiles

- Battles reference a **vulgo**, not an account, so a night can run with names that have no account yet.
- A vulgo with no owner can be claimed by an MC; admins, or organizers of a league where that vulgo battled, approve or reject. On approval the vulgo's whole history shows up on the MC's dashboard.
- A profile can own several vulgos (the profile UI to add/rename them comes later).
- If an MC deletes their account, their vulgos become unclaimed again and their history stays public.

## Data model

```
users (existing auth; role: user | admin)
 └─ mc_profiles             id, user_id (unique), slug
      └─ vulgos             id, name, slug (unique), mc_profile_id (null = unclaimed)
           └─ vulgo_claims  id, vulgo_id, mc_profile_id, status (pending|approved|rejected), decided_by, decided_at

leagues                     id, name, slug, created_by
 ├─ league_organizers       league_id, user_id, added_by
 └─ editions                id, league_id, number, date, status, bracket_size (8|16)
      ├─ edition_entries    id, edition_id, vulgo_id, number (arrival),
      │                     status (registered|selected|not_selected|withdrew), selected_by (arrival|draw|replacement)
      ├─ crowd_draws        id, edition_id, reason (selection|replacement), slots
      │    └─ crowd_draw_tickets  draw_id, entry_id, number (1..X), picked
      ├─ battles            id, edition_id, phase, position, entry_a, entry_b, winner_entry
      │    └─ battle_rounds id, battle_id, round_no (1–3), votes_a, votes_b, recorded_by, recorded_at
      └─ withdrawals        entry_id, battle_id, replacement_entry_id, method, recorded_by, recorded_at
```

## Out of scope (backlog)

Duplicate vulgos (two artists with the same name), filler names ("fecha chave" / "missing mc"), rankings, judges, extra profile/league/edition fields, profile UI for adding/renaming vulgos.
