import type { UserId } from '@/shared/lib/ids'

export type Role = 'user' | 'admin'

export type User = {
  id: UserId
  /** For a guest account, the address behind its nickname (never shown). */
  email: string
  name: string
  /** The nickname a guest account signs in with; null for accounts started with an email. */
  guestNickname: string | null
  role: Role
  /** Set while the account has an active deletion request (grace period). */
  pendingDeletion: { scheduledFor: Date } | null
  createdAt: Date
  updatedAt: Date
}
