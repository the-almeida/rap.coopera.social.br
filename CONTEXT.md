# Domain Glossary

This file holds the project's shared vocabulary. Terms here are canonical — code, conversations, and tests must use them consistently.

`/wc-grill` updates this file inline as terms are resolved.

## Glossary

**account deletion request** — A row in `account_deletion_requests` representing a user's pending or completed request to delete their account. Created by self-serve action or Facebook data-deletion callback. Status is derived from timestamp columns, not a separate enum.

**grace period** — The window between when an account deletion is requested and when the purge runs. Default 30 days, env-configurable. During this period the account is soft-deleted: the `auth.users` row still exists, but the user is gated to a pending-deletion interstitial on sign-in.

**pending deletion** — State of an account that has an active (non-cancelled, non-completed) deletion request. On sign-in, users in this state are redirected to `/account/pending-deletion` where they can cancel or sign out.

**access level** — Which account states a caller lets through (`requireUser({ allow })`). The default admits only active accounts. The **pending-deletion** allowance admits accounts pending deletion, for the flows that must keep working during the grace period (the pending-deletion page, cancelling or re-requesting deletion). Independent of role: an admin pending deletion is refused by default too.

**purge** — The terminal step of a deletion request: delete from `auth.users`, allowing `ON DELETE CASCADE` foreign keys to drop owned data. Runs on a `pg_cron` schedule reading `account_deletion_requests` where `scheduled_for < now()`.

**confirmation code** — Random 16-byte URL-safe token stored on each `account_deletion_requests` row. Used as the public handle for Facebook's status URL (`/data-deletion/status?code=…`). Distinct from the row UUID so internal IDs are not exposed.

**Data Protection Officer (DPO)** — The role defined by GDPR Art. 37 and LGPD Art. 41 (LGPD calls it "Encarregado" but accepts the DPO title). The contact responsible for handling data subject requests and privacy inquiries. Surfaced in the Privacy Policy via `{{DPO_NAME}}` / `{{DPO_EMAIL}}` placeholders.

**rights request channel** — The mailto link published in the Privacy Policy through which users exercise LGPD Art. 18 / GDPR Art. 15–22 rights (access, correction, deletion, portability, revocation). Self-serve account deletion is the in-app shortcut; the channel is the catch-all for everything else.

**rate limit** — A cap on how many times one subject (an email, an IP, a user) may call a public endpoint within a fixed window. It is defense against abuse, not authorization: when the backing store is unavailable the limit fails open (the call proceeds) and the failure is reported loudly to logs and Sentry. Distinct from Supabase Auth's own built-in limits, which apply only to Supabase endpoints.

**active OAuth provider** — An OAuth provider (Google, Facebook) whose client id is set in the app's environment. Only active providers get a button on the sign-in and sign-up pages. The provider must also be enabled in Supabase (dashboard in production, `supabase/config.toml` locally); the app checks that the two agree before a deploy. The client id is public, so having it in the app's environment exposes nothing.

**verified password** — The account's password was proven together with its mailbox: the emailed code and the password, both right in one go (the verify-password step after a password sign-up, or at the first password sign-in of an older account). Recorded as `password_verified_at`. Until then Supabase Auth refuses sessions opened with the password alone; code and OAuth sign-ins are unaffected. Distinct from a confirmed email, which only proves the mailbox.

**secure account** — An account that started with an email, Google or Facebook. Its email is confirmed, so it can be recovered through it. Its password, if any, is a **verified password** before it signs in alone. The first choice on the sign-in and sign-up pages ("secure/persistent account").

**guest account** — An account that started with a **nickname** and a password, no email ("visitor" or "visitant access" in the UI). Behind it is the address `<nickname>@guest.invalid`, which no mailbox can have and nobody ever sees. It cannot be recovered if the password is lost until it is **protected**. It stays a guest account while its email is on the guest domain; the nickname alone does not tell, since it stays with the account.

**nickname** — How a guest account signs in: 3 to 30 lowercase letters, digits or `_`, unique, and reserved for the account's whole life, so it keeps signing in after an email is added. Also its display name.

**protect (a guest account)** — Give it a way back: add a verified email (the app's own emailed code) or link Google or Facebook. Until then a banner on every protected page asks for it.

**evasive test** — A test containing steps or assertions that exist only to bypass a failing path (filling a field the code under test does not read, swallowing an expected exception with a generic catch, asserting absence of an element that was never going to render, sleeping instead of waiting on a real signal) rather than letting the failure surface the underlying bug. Detected by `@wc-test-auditor`, which runs from `/wc-tdd` after each GREEN. Findings are either resolved by editing the test or overridden inline with `// @wc-test-auditor-allow: <heuristic-id> — <reason>`. Distinct from "flaky test" (nondeterminism) and "brittle test" (over-coupled to implementation).

### Battle leagues

Full rules in [docs/mvp-spec.md](./docs/mvp-spec.md); these are the words they use.

**MC** — Every account. Gets an **MC profile** the first time an MC-facing feature needs one; its sign-up name (a guest's nickname) becomes its first **vulgo**.

**vulgo** — An MC's stage name, and what battles point at (not the account), so a night can run with names nobody has claimed. Accent and case variants are the same vulgo (one slug). Unclaimed until an MC owns it.

**vulgo claim** — An MC's request to own an unclaimed vulgo. Admins, or organizers of a league where the vulgo battled, approve or reject it. A sign-up whose name matches a vulgo with history opens a claim instead of taking it.

**league** — Created by an admin, run by its **organizers** (MCs the admin added; all equals, no owner). An organizer may battle in their own league.

**edition** — One battle night of a league, numbered per league. Status: registration → selection → in progress → completed (or cancelled).

**entry** — A vulgo on an edition's list, numbered by arrival. Selected by arrival, by **crowd draw**, or as a replacement.

**crowd draw** — The secret list that gives the MCs left over after selection random numbers 1..X; the crowd calls numbers and the organizer enters the picks. Only organizers and admins ever see it.

**bracket** — 8 or 16 selected entries, paired at random; redrawable until the first round is recorded.

**round** — One crowd vote between the two MCs of a battle. First to two rounds wins the battle; tied counts are refused (the organizer casts the tiebreaker vote).

**withdrawal** — An MC leaving an edition: replaced by a new crowd draw (before their first battle), by the MC they last beat (after a win), or by a walkover for the opponent.
