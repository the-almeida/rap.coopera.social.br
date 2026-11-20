export const Events = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_SIGNED_IN: 'user_signed_in',
  // A guest account got a way to recover it: a verified email or an OAuth link.
  ACCOUNT_PROTECTED: 'account_protected',
  USER_SIGNED_OUT: 'user_signed_out',
  CRITICAL_ERROR_SHOWN: 'critical_error_shown',
  EXPECTED_ERROR: 'expected_error',
  LEAGUE_CREATED: 'league_created',
  BRACKET_DRAWN: 'bracket_drawn',
  EDITION_COMPLETED: 'edition_completed',
  VULGO_CLAIM_DECIDED: 'vulgo_claim_decided',
} as const

export type EventName = (typeof Events)[keyof typeof Events]
