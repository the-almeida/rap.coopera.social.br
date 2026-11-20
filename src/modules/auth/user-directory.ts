import type { UserId } from '@/shared/lib/ids'

import { userRepository } from './adapters/user-repository.drizzle'
import { isGuestAccount } from './domain/guest'
import type { AccountLogin } from './domain/login'

/**
 * Read-only lookups other modules use to show or invite people (the leagues
 * module adding an organizer, listing organizers and claimants). Profile
 * fields only, never roles or account state.
 *
 * `email` is null for a guest account: its address on the guest domain is
 * never shown (CONTEXT.md, "guest account"); its name is its nickname.
 */
export type UserProfile = { id: UserId; name: string; email: string | null }

function toProfile(row: { id: UserId; name: string; email: string }): UserProfile {
  return { id: row.id, name: row.name, email: isGuestAccount(row) ? null : row.email }
}

/** The account behind an email (ignoring case) or a guest nickname. */
export async function findUserProfileByLogin(login: AccountLogin): Promise<UserProfile | null> {
  const found =
    login.kind === 'email'
      ? await userRepository.findByEmail(login.email)
      : await userRepository.findByGuestNickname(login.nickname)
  if (!found) return null
  const [row] = await userRepository.findProfilesByIds([found.id])
  return row ? toProfile(row) : null
}

export async function getUserProfiles(ids: readonly UserId[]): Promise<UserProfile[]> {
  const rows = await userRepository.findProfilesByIds([...new Set(ids)])
  return rows.map(toProfile)
}
