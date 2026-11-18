# 0009. Guest Accounts and Secure Accounts

Date: 2026-11-17
Status: Accepted. Supersedes 0008.

## Context

ADR-0008 let people in without signing up through Supabase's anonymous sign-in, and kept Confirm email off so that keeping the account was one step. Two things went wrong with it. An anonymous account whose session was lost (cookies cleared, another device) could never be reached again. And with Confirm email off, anyone could register someone else's address with a password of their own; when the real owner later signed in by code or OAuth, both shared the account. The safeguard that replaced the password on the first proof of the email left a window until that proof and needed a lock against writes already on their way.

The owner wants the opposite balance: the email of a secure account is always confirmed, and a visitor who does not want to give an email still gets an account to come back to.

## Decision

- **Two kinds of account, chosen first.** `/sign-in` and `/sign-up` start with a choice: a **secure account** (email, Google or Facebook), which can be recovered, or **guest access** with a nickname, which cannot until it is protected. Only the chosen path shows. The step lives in the URL (`?method=account|guest`); the last choice is remembered in a cookie holding only that choice.
- **Secure accounts confirm their email.** Confirm email is on. A password is trusted only once the same person proved it together with the mailbox: the emailed code and the password, both right in one go (`password_verified_at`). Supabase Auth enforces it through an access token hook, so it also holds for direct calls to Supabase and for refreshes of older sessions; a second factor does not count as a mailbox proof, and a changed password must be proven again.
- **Guest accounts are a nickname and a password.** Supabase identifies password accounts by email, so a nickname maps to `<nickname>@guest.invalid` (RFC 2606: no mailbox can exist). The server creates these through the admin API, marked as guests; the app's email fields reject the domain, and the database refuses it on any account the server did not mark, which also covers direct calls with the public key. Creating the account is the only proof a guest address can have, so its password is trusted at creation. One action signs a returning nickname in or creates a new one. Every attempt asks for a Turnstile CAPTCHA (the admin API skips Supabase's own) and is rate limited per IP and per nickname, with a stricter budget for creating accounts.
- **Guests protect themselves later.** A banner on protected pages stays until the guest adds a verified email or links Google or Facebook (`/account/protect`). The email is verified with the app's own 6-digit code and applied through the admin API, because Supabase's secure email change would also confirm on the guest address, which cannot receive mail. The nickname stays with the account for good and keeps signing it in. Manual linking is on for the project; a database trigger allows a provider link only on a guest account or for a provider account with the account's own email.
- **No anonymous accounts.** Supabase's anonymous sign-in is off, and the pre-build check fails while a project still allows it.

## Alternatives considered

- **Keep ADR-0008 (anonymous accounts, Confirm email off).** Rejected: lost sessions lose the account, and the takeover needed a safeguard with a window.
- **Guests as anonymous accounts with a nickname shown on top.** Rejected: still no way back after the session is lost.
- **Confirm email on alone, without verifying passwords.** Rejected: the owner's code sign-in would confirm an address a stranger registered and activate the stranger's password, and accounts and sessions from before the change would be untouched.
- **A username column with its own password check.** Rejected: it would duplicate Supabase's password handling and sessions; the reserved domain reuses them.

## Consequences

- A password sign-up takes the emailed code before the first session; an older account confirms once at its next password sign-in.
- Production needs Confirm email on, the access token hook enabled, manual linking on, Turnstile keys and an email provider for the app's own codes (`docs/deployment.md`).
- A guest who loses the password before protecting the account loses it; the form says so.
- Guest passwords can be guessed by calling Supabase directly, past the app's limits and CAPTCHA (see `docs/conventions.md`, "Auth: accepted trade-offs").
